export const alertsMigration = `
  ALTER TABLE system_settings ADD COLUMN staleSeconds INTEGER NOT NULL DEFAULT 20 CHECK (staleSeconds BETWEEN 5 AND 3600);
  ALTER TABLE system_settings ADD COLUMN notifyEnvironment INTEGER NOT NULL DEFAULT 1 CHECK (notifyEnvironment IN (0, 1));
  ALTER TABLE system_settings ADD COLUMN notifyBrowser INTEGER NOT NULL DEFAULT 1 CHECK (notifyBrowser IN (0, 1));
  ALTER TABLE system_settings ADD COLUMN notifyIrrigation INTEGER NOT NULL DEFAULT 1 CHECK (notifyIrrigation IN (0, 1));

  CREATE TABLE alerts (
    id INTEGER PRIMARY KEY,
    sensor TEXT NOT NULL REFERENCES sensors(id),
    type TEXT NOT NULL CHECK (type IN ('humidity_low','humidity_high','temperature_low','temperature_high','disconnected','no_response','stale','communication')),
    severity TEXT NOT NULL CHECK (severity IN ('warning','critical')),
    value REAL,
    threshold REAL,
    detail TEXT,
    createdAt INTEGER NOT NULL,
    resolvedAt INTEGER,
    readAt INTEGER
  ) STRICT;
  CREATE UNIQUE INDEX alerts_active_condition ON alerts(sensor, type) WHERE resolvedAt IS NULL;
  CREATE INDEX alerts_created ON alerts(createdAt DESC, id DESC);
  CREATE INDEX alerts_unread ON alerts(createdAt DESC) WHERE readAt IS NULL;
`
