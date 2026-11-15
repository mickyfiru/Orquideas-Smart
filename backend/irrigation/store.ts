import type { DatabaseSync } from 'node:sqlite'
import { nextOccurrence } from '../../shared/irrigation.ts'
import type { IrrigationOccurrence, IrrigationNotification, Schedule, ScheduleInput } from '../../shared/irrigation.ts'

type ScheduleRow = Omit<Schedule, 'weekdays' | 'active'> & { weekdays: string; active: number; nextDue: number | null; deletedAt: number | null }
const occurrenceFields = 'scheduleId, scheduledAt, name, completedAt'
const decode = ({ weekdays, active, nextDue: _nextDue, deletedAt: _deletedAt, ...rest }: ScheduleRow): Schedule => ({
  ...rest, weekdays: JSON.parse(weekdays) as number[], active: Boolean(active),
})

export function createIrrigationStore(db: DatabaseSync, transaction: <T>(work: () => T) => T) {
  const liveSchedules = 'FROM irrigation_schedules WHERE deletedAt IS NULL'
  const active = db.prepare(`SELECT * ${liveSchedules} AND active = 1 AND nextDue IS NOT NULL`)
  const due = db.prepare(`SELECT * ${liveSchedules} AND active = 1 AND nextDue <= ?`)
  const all = db.prepare(`SELECT * ${liveSchedules} ORDER BY id DESC`)
  const byId = db.prepare(`SELECT * ${liveSchedules} AND id = ?`)
  const insert = db.prepare('INSERT INTO irrigation_schedules (name,date,time,recurrence,weekdays,active,nextDue,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?,?)')
  const update = db.prepare(`UPDATE irrigation_schedules SET name=?, date=?, time=?, recurrence=?, weekdays=?, active=?, nextDue=?, updatedAt=?
    WHERE id=? AND deletedAt IS NULL`)
  const remove = db.prepare('UPDATE irrigation_schedules SET active=0, nextDue=NULL, updatedAt=?, deletedAt=? WHERE id=? AND deletedAt IS NULL')
  const setNext = db.prepare('UPDATE irrigation_schedules SET nextDue=? WHERE id=?')
  const findEvent = db.prepare(`SELECT ${occurrenceFields} FROM irrigation_events WHERE scheduleId=? AND scheduledAt=?`)
  const notify = db.prepare('INSERT INTO irrigation_events (scheduleId,scheduledAt,name,notifiedAt) VALUES (?,?,?,?) ON CONFLICT (scheduleId,scheduledAt) DO NOTHING')
  const complete = db.prepare(`INSERT INTO irrigation_events (scheduleId,scheduledAt,name,completedAt) VALUES (?,?,?,?)
    ON CONFLICT (scheduleId,scheduledAt) DO UPDATE SET completedAt=COALESCE(irrigation_events.completedAt, excluded.completedAt)`)
  const read = db.prepare('UPDATE irrigation_events SET readAt=COALESCE(readAt,?) WHERE id=? AND notifiedAt IS NOT NULL')
  const byMonth = db.prepare(`SELECT ${occurrenceFields} FROM irrigation_events WHERE scheduledAt>=? AND scheduledAt<?`)
  const completed = db.prepare(`SELECT ${occurrenceFields} FROM irrigation_events WHERE completedAt IS NOT NULL ORDER BY completedAt DESC, id DESC`)
  const notifications = db.prepare(`SELECT id, ${occurrenceFields}, notifiedAt, readAt FROM irrigation_events WHERE notifiedAt IS NOT NULL ORDER BY notifiedAt DESC, scheduledAt DESC, id DESC`)
  const recentNotifications = db.prepare(`SELECT id, ${occurrenceFields}, notifiedAt, readAt FROM irrigation_events
    WHERE notifiedAt IS NOT NULL ORDER BY notifiedAt DESC, scheduledAt DESC, id DESC LIMIT 30`)
  const unreadNotifications = db.prepare('SELECT count(*) AS total FROM irrigation_events WHERE notifiedAt IS NOT NULL AND readAt IS NULL')

  const find = (id: number) => byId.get(id) as unknown as ScheduleRow | undefined
  const event = (id: number, at: number) => findEvent.get(id, at) as unknown as IrrigationOccurrence | undefined
  const nextAvailable = (schedule: Schedule, from: number) => {
    let next = nextOccurrence(schedule, from)
    while (next !== null && event(schedule.id, next)) next = nextOccurrence(schedule, next + 1)
    return next
  }

  function advance(now: number) {
    let changed = false
    for (const row of due.all(now) as unknown as ScheduleRow[]) {
      const schedule = decode(row)
      let next: number | null = row.nextDue
      while (next !== null && next <= now) {
        notify.run(schedule.id, next, schedule.name, now)
        next = nextAvailable(schedule, next + 1)
      }
      setNext.run(next, schedule.id)
      changed = true
    }
    return changed
  }

  function fields(input: ScheduleInput) {
    return [input.name, input.date, input.time, input.recurrence, JSON.stringify(input.weekdays), Number(input.active)] as const
  }
  const minute = (now: number) => Math.floor(now / 60_000) * 60_000

  function project(from: number, until: number, perSchedule: number) {
    const entries: IrrigationOccurrence[] = []
    for (const row of active.all() as unknown as ScheduleRow[]) {
      if (row.nextDue === null || row.nextDue >= until) continue
      const schedule = decode(row)
      let next = nextAvailable(schedule, Math.max(from, row.nextDue))
      for (let count = 0; next !== null && next < until && count < perSchedule; count++) {
        entries.push({ scheduleId: schedule.id, name: schedule.name, scheduledAt: next, completedAt: null })
        next = nextAvailable(schedule, next + 1)
      }
    }
    return entries
  }
  const order = (a: IrrigationOccurrence, b: IrrigationOccurrence) => a.scheduledAt - b.scheduledAt || a.scheduleId - b.scheduleId

  return {
    advance: (now: number) => transaction(() => advance(now)),
    schedules: () => (all.all() as unknown as ScheduleRow[]).map(decode),
    create(input: ScheduleInput, now: number) {
      return transaction(() => {
        const result = insert.run(...fields(input), nextOccurrence(input, minute(now)), now, now)
        advance(now)
        return decode(find(Number(result.lastInsertRowid))!)
      })
    },
    update(id: number, input: ScheduleInput, now: number) {
      return transaction(() => {
        const previous = find(id)
        if (!previous) return null
        advance(now)
        const due = nextAvailable({ ...decode(previous), ...input }, minute(now))
        update.run(...fields(input), due, now, id)
        advance(now)
        return decode(find(id)!)
      })
    },
    remove(id: number, now: number) {
      return transaction(() => {
        if (!find(id)) return false
        advance(now)
        return remove.run(now, now, id).changes === 1
      })
    },
    record(id: number, at: number, now: number) {
      return transaction(() => {
        advance(now)
        const previous = event(id, at)
        if (previous) {
          complete.run(id, at, previous.name, now)
          return event(id, at)!
        }
        const row = find(id)
        if (!row || row.nextDue === null || row.nextDue > at || at < now) return null
        const schedule = decode(row)
        if (nextOccurrence(schedule, at) !== at) return null
        complete.run(id, at, schedule.name, now)
        if (row.nextDue === at) setNext.run(nextAvailable(schedule, at + 1), id)
        return event(id, at)!
      })
    },
    calendar(from: number, until: number) {
      const stored = byMonth.all(from, until) as unknown as IrrigationOccurrence[]
      return [...stored, ...project(from, until, 32)].sort(order)
    },
    upcoming(now: number) {
      return project(now, Infinity, 10).sort(order).slice(0, 10)
    },
    next(now: number) {
      return project(now, Infinity, 1).sort(order)[0]?.scheduledAt ?? null
    },
    completed: () => completed.all() as unknown as IrrigationOccurrence[],
    notifications: () => notifications.all() as unknown as IrrigationNotification[],
    inbox: () => ({
      rows: recentNotifications.all() as unknown as IrrigationNotification[],
      unread: Number(unreadNotifications.get()?.total),
    }),
    markRead: (id: number, now: number) => read.run(now, id).changes === 1,
  }
}
