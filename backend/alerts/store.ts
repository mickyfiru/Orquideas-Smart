import type { DatabaseSync } from 'node:sqlite'
import type { AlertEvent, AlertPage, AlertType, Severity } from '../../shared/alerts.ts'
import type { Mode } from '../../shared/telemetry.ts'

export type Occurrence = Pick<AlertEvent, 'type' | 'severity' | 'value' | 'threshold' | 'detail'>
export interface AlertFilters {
  from?: number; until?: number; sensor?: Mode; type?: AlertType; severity?: Severity;
  status?: 'active' | 'resolved'; unread?: boolean; page: number; pageSize: number
}

export function createAlertStore(db: DatabaseSync, transaction: <T>(work: () => T) => T) {
  const active = db.prepare('SELECT * FROM alerts WHERE sensor=? AND resolvedAt IS NULL')
  const start = db.prepare(`INSERT INTO alerts (sensor,type,severity,value,threshold,detail,createdAt)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
  const resolve = db.prepare('UPDATE alerts SET resolvedAt=? WHERE sensor=? AND type=? AND resolvedAt IS NULL')
  const resolveOther = db.prepare('UPDATE alerts SET resolvedAt=? WHERE sensor<>? AND resolvedAt IS NULL')
  const summary = db.prepare('SELECT count(*) FILTER (WHERE resolvedAt IS NULL) AS active, count(*) FILTER (WHERE readAt IS NULL) AS unread FROM alerts')
  const recent = db.prepare('SELECT * FROM alerts ORDER BY createdAt DESC, id DESC LIMIT 30')
  const read = db.prepare('UPDATE alerts SET readAt=COALESCE(readAt,?) WHERE id=?')

  return {
    active: (mode: Mode) => active.all(mode) as unknown as AlertEvent[],
    update(mode: Mode, open: Occurrence[], close: AlertType[], now: number) {
      return transaction(() => {
        let changes = 0
        for (const type of close) changes += Number(resolve.run(now, mode, type).changes)
        for (const item of open) changes += Number(start.run(mode, item.type, item.severity, item.value, item.threshold, item.detail, now).changes)
        return changes > 0
      })
    },
    resolveOther: (mode: Mode, now: number) => Number(resolveOther.run(now, mode).changes) > 0,
    counts: () => summary.get() as unknown as { active: number; unread: number },
    recent: () => recent.all() as unknown as AlertEvent[],
    markRead: (id: number, now: number) => read.run(now, id).changes > 0,
    page(filters: AlertFilters): AlertPage {
      const clauses: string[] = []
      const args: Array<string | number> = []
      function add(sql: string, value: string | number | undefined) {
        if (value !== undefined) { clauses.push(sql); args.push(value) }
      }
      add('createdAt >= ?', filters.from)
      add('createdAt < ?', filters.until)
      add('sensor = ?', filters.sensor)
      add('type = ?', filters.type)
      add('severity = ?', filters.severity)
      if (filters.status) clauses.push(filters.status === 'active' ? 'resolvedAt IS NULL' : 'resolvedAt IS NOT NULL')
      if (filters.unread) clauses.push('readAt IS NULL')
      const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''
      const total = Number(db.prepare('SELECT count(*) AS total FROM alerts' + where).get(...args)?.total)
      const rows = db.prepare('SELECT * FROM alerts' + where + ' ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?')
        .all(...args, filters.pageSize, (filters.page - 1) * filters.pageSize) as unknown as AlertEvent[]
      return { rows, total, page: filters.page, pageSize: filters.pageSize }
    },
  }
}
