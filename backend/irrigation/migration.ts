export const irrigationMigration = `
  CREATE TABLE irrigation_schedules (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    recurrence TEXT NOT NULL CHECK (recurrence IN ('once', 'daily', 'weekly', 'custom')),
    weekdays TEXT NOT NULL CHECK (json_valid(weekdays)),
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    nextDue INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    deletedAt INTEGER
  ) STRICT;
  CREATE INDEX irrigation_due ON irrigation_schedules(nextDue)
    WHERE active = 1 AND deletedAt IS NULL;

  CREATE TABLE irrigation_events (
    id INTEGER PRIMARY KEY,
    scheduleId INTEGER NOT NULL REFERENCES irrigation_schedules(id),
    scheduledAt INTEGER NOT NULL,
    name TEXT NOT NULL,
    notifiedAt INTEGER,
    readAt INTEGER CHECK (readAt IS NULL OR notifiedAt IS NOT NULL),
    completedAt INTEGER,
    CHECK (notifiedAt IS NOT NULL OR completedAt IS NOT NULL),
    UNIQUE (scheduleId, scheduledAt)
  ) STRICT;
  CREATE INDEX irrigation_event_date ON irrigation_events(scheduledAt);
  CREATE INDEX irrigation_completed ON irrigation_events(completedAt) WHERE completedAt IS NOT NULL;
  CREATE INDEX irrigation_notified ON irrigation_events(notifiedAt) WHERE notifiedAt IS NOT NULL;
`
