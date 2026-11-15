import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { WebSocket, WebSocketServer } from 'ws'
import { evaluateEnvironment, ranges, sampleInterval } from '../shared/telemetry.ts'
import type { DashboardSnapshot, Measurement, Mode, Range } from '../shared/telemetry.ts'
import { openDatabase } from './database.ts'
import { getConnection, simulation } from './source.ts'
import type { AcquisitionSource } from './source.ts'
import { createIrrigationRouter } from './irrigation/routes.ts'
import { createSerialAcquisition } from './sensors/serial.ts'
import { createSensorRouter } from './sensors/routes.ts'
import { createHistoryRouter } from './history/routes.ts'
import { createAlertEngine } from './alerts/engine.ts'
import { createAlertRouter, notificationInbox } from './alerts/routes.ts'
import { createSettingsRouter } from './settings/routes.ts'

export function createApplication(
  path: string, initial: AcquisitionSource | Mode | null, staticRoot?: string,
  clock = Date.now, serial = createSerialAcquisition(),
) {
  const db = openDatabase(path)
  const sourceFor = (mode: Mode) => mode === 'arduino' ? serial.source : simulation
  let source = initial && typeof initial === 'object' ? initial : sourceFor(initial ?? db.acquisition().mode)
  const lastReading = (mode: Mode) => db.latestReceived(mode) ?? db.latest(mode)
  let latest = lastReading(source.mode)
  let live: Measurement[] = []
  let irrigationRevision = randomUUID()
  let alertsRevision = randomUUID()
  const evaluateAlerts = createAlertEngine(db.alerts)
  const snapshot = (): DashboardSnapshot => {
    const settings = db.settings()
    const port = serial.status()
    const connection = source === serial.source && source.connected && !port.hasReading
      ? (latest ? 'stale' : 'empty')
      : getConnection(source.mode, source.connected, latest, clock(), settings.staleSeconds * 1000)
    return {
      mode: source.mode, connection, latest,
      connectedSensors: Number(source.mode === 'arduino' && connection === 'connected'),
      physicalSensors: 1,
      nextIrrigation: db.irrigation.next(clock()),
      irrigationRevision,
      alertsRevision,
      activeAlerts: db.alerts.counts().active,
      settings,
      serial: { ...port, path: port.path ?? db.acquisition().port },
      conditions: evaluateEnvironment(latest, source.mode === 'arduino' && port.errorKind ? 'stale' : connection, settings),
    }
  }

  const app = express()
  app.disable('x-powered-by')
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  app.get('/api/dashboard', (_req, res) => res.json(snapshot()))
  app.get('/api/readings', (req, res) => {
    const range = req.query.range
    if (typeof range !== 'string' || !Object.hasOwn(ranges, range)) {
      res.status(400).json({ error: 'Selecciona un rango válido.' })
      return
    }
    const now = Date.now()
    const from = now - ranges[range as Range]
    const mode = req.query.mode ?? source.mode
    if (mode !== 'arduino' && mode !== 'simulation') return res.status(400).json({ error: 'Selecciona un origen válido.' })
    if (req.query.archive === '1' && range !== 'live') {
      return res.json(db.archive.series({ from, until: now + 1, origin: mode })[0]?.points ?? [])
    }
    const readings = range === 'live'
      ? mode === source.mode ? live.filter(reading => reading.time >= from) : []
      : db.history(mode, from, now)
    if (range !== 'live' && mode === 'arduino') {
      const last = db.latestReceived(mode)
      if (last && last.time >= from && last.time <= now && last.time > (readings.at(-1)?.time ?? 0)) readings.push(last)
    }
    res.json(readings)
  })
  app.use('/api/irrigation', createIrrigationRouter(db.irrigation, clock, irrigationChanged))
  app.use('/api/sensors', createSensorRouter(db, serial, () => source, changeMode, () => updateAlerts('settings')))
  app.use('/api/history', createHistoryRouter(db, () => broadcast()))
  app.use('/api/alerts', createAlertRouter(db, alertsChanged, clock))
  app.get('/api/notifications', (_req, res) => res.json(notificationInbox(db)))
  app.use('/api/settings', createSettingsRouter(db, snapshot, limits => limits ? updateAlerts('settings') : alertsChanged()))
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta de API inexistente.' }))
  if (staticRoot && existsSync(resolve(staticRoot, 'index.html'))) {
    app.use(express.static(staticRoot))
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticRoot, 'index.html')))
  }

  const server = createServer(app)
  const sockets = new WebSocketServer({ server, path: '/telemetria' })
  sockets.on('connection', socket => {
    socket.on('error', error => console.error('Error en WebSocket', error.message))
    socket.send(JSON.stringify(snapshot()))
  })
  const broadcast = () => {
    const message = JSON.stringify(snapshot())
    for (const socket of sockets.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    }
  }
  function irrigationChanged() {
    irrigationRevision = randomUUID()
    broadcast()
  }
  function alertsChanged() {
    alertsRevision = randomUUID()
    broadcast()
  }
  function updateAlerts(trigger: 'reading' | 'state' | 'settings') {
    try {
      if (evaluateAlerts(snapshot(), clock(), trigger)) alertsRevision = randomUUID()
    } catch (error) {
      console.error('No se pudieron evaluar las alertas.', error)
    }
    broadcast()
  }
  const checkReminders = () => {
    try {
      if (db.irrigation.advance(clock())) irrigationChanged()
    } catch (error) {
      console.error('No se pudieron actualizar los recordatorios de riego.', error)
    }
  }
  checkReminders()
  const reminders = setInterval(checkReminders, 1_000)
  let stop: ReturnType<AcquisitionSource['start']>
  function startSource() {
    const active = source
    if (active.mode === 'simulation') db.seedSimulation(Date.now())
    latest = lastReading(active.mode)
    live = []
    stop = active.start(reading => {
      if (source !== active) return
      if (![reading.time, reading.humidity, reading.temperature].every(Number.isFinite)
        || !Number.isSafeInteger(reading.time) || reading.time <= 0 || reading.time > clock()
        || reading.humidity < 0 || reading.humidity > 100 || reading.temperature < -50 || reading.temperature > 100) return
      try {
        db.record(active.mode, reading, db.settings().storageMinutes)
        latest = reading
        live = live.filter(item => item.time >= reading.time - ranges.live && item.time !== reading.time)
        live.push(reading)
        updateAlerts('reading')
      } catch (error) {
        console.error('No se pudo registrar la lectura.', error)
      }
    }, () => updateAlerts('state'))
  }
  function changeMode(mode: Mode) {
    db.setMode(mode)
    if (source.mode === mode) return
    source = sourceFor(mode)
    void Promise.resolve(stop()).catch(error => console.error('No se pudo cerrar la fuente anterior.', error))
    startSource()
    updateAlerts('state')
  }
  startSource()
  updateAlerts('state')
  const timer = setInterval(() => updateAlerts('state'), sampleInterval)
  return {
    server,
    async close() {
      clearInterval(timer)
      clearInterval(reminders)
      try {
        await stop()
        await serial.disconnect()
      } catch (error) {
        console.error('No se pudo cerrar la fuente de adquisición.', error)
      }
      for (const socket of sockets.clients) socket.terminate()
      sockets.close()
      await new Promise<void>(resolveClose => server.close(() => resolveClose()))
      db.close()
    }
  }
}
