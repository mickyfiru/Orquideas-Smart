import { DatabaseSync } from 'node:sqlite'
import type { DashboardSnapshot, Measurement, Mode, RegisteredSensor } from '../shared/telemetry.ts'
import { simulatedReading } from './source.ts'
import { irrigationMigration } from './irrigation/migration.ts'
import { createIrrigationStore } from './irrigation/store.ts'
import { acquisitionMigration } from './sensors/migration.ts'
import { createHistoryStore } from './history/store.ts'
import { createAlertStore } from './alerts/store.ts'
import { alertsMigration } from './alerts/migration.ts'
import type { NotificationPreferences } from '../shared/alerts.ts'
import type { EnvironmentalSettings } from '../shared/settings.ts'

const hour = 3_600_000
const schema = `
  CREATE TABLE sensors (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL UNIQUE CHECK (mode IN ('simulation', 'arduino')),
    name TEXT NOT NULL,
    controller TEXT
  ) STRICT;
  INSERT INTO sensors VALUES
    ('simulation', 'simulation', 'Fuente de simulación', NULL),
    ('arduino', 'arduino', 'DHT11', 'Arduino UNO R3');

  CREATE TABLE environmental_readings (
    sensor_id TEXT NOT NULL REFERENCES sensors(id),
    time INTEGER NOT NULL CHECK (time > 0),
    humidity REAL NOT NULL CHECK (humidity BETWEEN 0 AND 100),
    temperature REAL NOT NULL CHECK (temperature BETWEEN -50 AND 100),
    PRIMARY KEY (sensor_id, time)
  ) STRICT;

  CREATE TABLE system_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    humidityTarget REAL NOT NULL CHECK (humidityTarget BETWEEN 0 AND 100),
    humidityTolerance REAL NOT NULL CHECK (humidityTolerance BETWEEN 0 AND 100),
    temperatureMin REAL NOT NULL,
    temperatureMax REAL NOT NULL CHECK (temperatureMax >= temperatureMin),
    storageMinutes INTEGER NOT NULL CHECK (storageMinutes > 0),
    simulationSeeded INTEGER NOT NULL CHECK (simulationSeeded IN (0, 1))
  ) STRICT;
  INSERT INTO system_settings VALUES (1, 80, 5, 18, 24, 60, 0);
`

export function openDatabase(path: string) {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
  const transaction = <T>(work: () => T): T => {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  transaction(() => {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 5) throw new Error('La base de datos requiere una versión más reciente de la aplicación.')
    if (version === 0) db.exec(schema + 'PRAGMA user_version = 1;')
    if (version < 2) db.exec(irrigationMigration + 'PRAGMA user_version = 2;')
    if (version < 3) db.exec(acquisitionMigration + 'PRAGMA user_version = 3;')
    if (version < 4) db.exec('CREATE INDEX environmental_readings_by_time ON environmental_readings(time, sensor_id); PRAGMA user_version = 4;')
    if (version < 5) db.exec(alertsMigration + 'PRAGMA user_version = 5;')
  })

  const write = db.prepare('INSERT INTO environmental_readings VALUES (?, ?, ?, ?)')
  const latest = db.prepare('SELECT time, humidity, temperature FROM environmental_readings WHERE sensor_id = ? ORDER BY time DESC LIMIT 1')
  const history = db.prepare('SELECT time, humidity, temperature FROM environmental_readings WHERE sensor_id = ? AND time >= ? AND time <= ? ORDER BY time')
  const settings = db.prepare('SELECT humidityTarget, humidityTolerance, temperatureMin, temperatureMax, storageMinutes, staleSeconds FROM system_settings WHERE id = 1')
  const environment = db.prepare('UPDATE system_settings SET humidityTarget=?, humidityTolerance=?, temperatureMin=?, temperatureMax=?, staleSeconds=? WHERE id=1')
  const preferences = db.prepare('SELECT notifyEnvironment AS environmental, notifyBrowser AS browser, notifyIrrigation AS irrigation FROM system_settings WHERE id=1')
  const savePreferences = db.prepare('UPDATE system_settings SET notifyEnvironment=?, notifyBrowser=?, notifyIrrigation=? WHERE id=1')
  const tolerance = db.prepare('UPDATE system_settings SET humidityTolerance = ? WHERE id = 1')
  const storageMinutes = db.prepare('UPDATE system_settings SET storageMinutes = ? WHERE id = 1')
  const getAcquisition = db.prepare('SELECT mode, port FROM acquisition_settings WHERE id = 1')
  const setMode = db.prepare('UPDATE acquisition_settings SET mode = ? WHERE id = 1')
  const setPort = db.prepare('UPDATE acquisition_settings SET port = ? WHERE id = 1')
  const sensors = db.prepare("SELECT id, name, CASE mode WHEN 'arduino' THEN 'DHT11' ELSE 'Simulación ambiental' END AS type, controller FROM sensors ORDER BY id")
  const lastReceived = db.prepare('SELECT time, humidity, temperature FROM latest_sensor_readings WHERE sensor_id = ?')
  const saveReceived = db.prepare(`INSERT INTO latest_sensor_readings VALUES (?, ?, ?, ?)
    ON CONFLICT(sensor_id) DO UPDATE SET time=excluded.time, humidity=excluded.humidity, temperature=excluded.temperature
    WHERE excluded.time >= latest_sensor_readings.time`)
  const insert = (mode: Mode, reading: Measurement) => write.run(mode, reading.time, reading.humidity, reading.temperature)

  return {
    irrigation: createIrrigationStore(db, transaction),
    archive: createHistoryStore(db, path),
    alerts: createAlertStore(db, transaction),
    close: () => db.close(),
    settings: () => settings.get() as unknown as DashboardSnapshot['settings'],
    setEnvironment: (value: EnvironmentalSettings) => environment.run(value.humidityTarget, value.humidityTolerance, value.temperatureMin, value.temperatureMax, value.staleSeconds),
    preferences(): NotificationPreferences {
      const row = preferences.get()
      return { environmental: Boolean(row?.environmental), browser: Boolean(row?.browser), irrigation: Boolean(row?.irrigation) }
    },
    setPreferences: (value: NotificationPreferences) => savePreferences.run(Number(value.environmental), Number(value.browser), Number(value.irrigation)),
    setTolerance: (value: number) => tolerance.run(value),
    setStorageMinutes: (value: number) => storageMinutes.run(value),
    acquisition: () => getAcquisition.get() as unknown as { mode: Mode; port: string | null },
    setMode: (mode: Mode) => setMode.run(mode),
    setPort: (port: string) => setPort.run(port),
    sensors: () => sensors.all() as unknown as RegisteredSensor[],
    latest: (mode: Mode) => (latest.get(mode) as unknown as Measurement | undefined) ?? null,
    latestReceived: (mode: Mode) => (lastReceived.get(mode) as unknown as Measurement | undefined) ?? null,
    history: (mode: Mode, from: number, to: number) => history.all(mode, from, to) as unknown as Measurement[],
    record(mode: Mode, reading: Measurement, intervalMinutes: number) {
      transaction(() => {
        const previous = latest.get(mode)
        if (mode === 'arduino') saveReceived.run(mode, reading.time, reading.humidity, reading.temperature)
        if (!previous || reading.time - Number(previous.time) >= intervalMinutes * 60_000) insert(mode, reading)
      })
    },
    seedSimulation(now: number) {
      transaction(() => {
        if (db.prepare('SELECT simulationSeeded FROM system_settings WHERE id = 1').get()?.simulationSeeded) return
        for (let time = now - 30 * 24 * hour; time < now; time += hour) {
          insert('simulation', simulatedReading(time))
        }
        db.exec('UPDATE system_settings SET simulationSeeded = 1 WHERE id = 1')
      })
    },
  }
}
