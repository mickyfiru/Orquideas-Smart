export const acquisitionMigration = `
  CREATE TABLE acquisition_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL CHECK (mode IN ('simulation', 'arduino')),
    port TEXT
  ) STRICT;
  INSERT INTO acquisition_settings VALUES (1, 'simulation', NULL);

  CREATE TABLE latest_sensor_readings (
    sensor_id TEXT PRIMARY KEY REFERENCES sensors(id),
    time INTEGER NOT NULL CHECK (time > 0),
    humidity REAL NOT NULL CHECK (humidity BETWEEN 0 AND 100),
    temperature REAL NOT NULL CHECK (temperature BETWEEN -50 AND 100)
  ) STRICT;
`
