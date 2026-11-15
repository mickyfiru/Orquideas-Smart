import { DatabaseSync } from 'node:sqlite'
import type { HistoryPage, HistoryReading, HistoryStatistics, HistorySummary } from '../../shared/history.ts'
import type { Measurement, Mode } from '../../shared/telemetry.ts'
import type { HistoryFilters, HistoryQuery } from './query.ts'

type StoredRow = Omit<HistoryReading, 'valid'>
const columns = 'sensorId, origin, time, humidity, temperature, condition'
const chartLimit = 360

function queryScope(filters: HistoryFilters) {
  const args: Array<string | number> = [filters.from, filters.until]
  const predicates = ['r.time >= ?', 'r.time < ?']
  if (filters.sensor) { predicates.push('r.sensor_id = ?'); args.push(filters.sensor) }
  if (filters.origin) { predicates.push('s.mode = ?'); args.push(filters.origin) }
  if (filters.condition) args.push(filters.condition)
  const sql = `
    WITH classified AS (
      SELECT r.sensor_id AS sensorId, s.mode AS origin, r.time, r.humidity, r.temperature,
        CASE WHEN r.humidity BETWEEN max(0, c.humidityTarget - c.humidityTolerance)
                                AND min(100, c.humidityTarget + c.humidityTolerance)
          AND r.temperature BETWEEN c.temperatureMin AND c.temperatureMax
        THEN 'normal' ELSE 'out' END AS condition
      FROM environmental_readings r
      JOIN sensors s ON s.id = r.sensor_id
      CROSS JOIN system_settings c
      WHERE c.id = 1 AND ${predicates.join(' AND ')}
    ), filtered AS (
      SELECT ${columns} FROM classified ${filters.condition ? 'WHERE condition = ?' : ''}
    )`
  return { sql, args }
}

function order(query: HistoryQuery) {
  // Both fields have already been checked against closed allowlists.
  return `${query.sort} ${query.direction}, time DESC, sensorId ASC`
}

export function createHistoryStore(db: DatabaseSync, path: string) {
  function series(filters: HistoryFilters): HistorySummary['series'] {
    const { sql, args } = queryScope(filters)
    const rows = db.prepare(`${sql}, ranked AS (
      SELECT origin, time, humidity, temperature,
        row_number() OVER (PARTITION BY origin ORDER BY time, sensorId) AS position,
        count(*) OVER (PARTITION BY origin) AS total
      FROM filtered
    )
    SELECT origin, time, humidity, temperature, total FROM ranked
    WHERE total <= ${chartLimit} OR position IN (1, total)
      OR ((position - 1) * (${chartLimit} - 1)) / (total - 1) <> ((position - 2) * (${chartLimit} - 1)) / (total - 1)
    ORDER BY origin, time, position`).all(...args) as unknown as Array<Measurement & { origin: Mode; total: number }>
    const groups = new Map<Mode, HistorySummary['series'][number]>()
    for (const { origin, total, ...point } of rows) {
      const group = groups.get(origin) ?? { origin, total, points: [] }
      group.points.push(point)
      groups.set(origin, group)
    }
    return [...groups.values()]
  }

  return {
    series,
    page(query: HistoryQuery): HistoryPage {
      const { sql, args } = queryScope(query.filters)
      const total = Number(db.prepare(`${sql} SELECT count(*) AS total FROM filtered`).get(...args)?.total)
      const rows = db.prepare(`${sql} SELECT ${columns} FROM filtered
        ORDER BY ${order(query)} LIMIT ? OFFSET ?`).all(...args, query.pageSize, (query.page - 1) * query.pageSize) as unknown as StoredRow[]
      return { rows: rows.map(row => ({ ...row, valid: true })), total, page: query.page, pageSize: query.pageSize }
    },
    statistics(filters: HistoryFilters): HistoryStatistics {
      const { sql, args } = queryScope(filters)
      return db.prepare(`${sql} SELECT
        count(*) AS total, count(*) FILTER (WHERE condition = 'out') AS outOfRange,
        100.0 * count(*) FILTER (WHERE condition = 'normal') / nullif(count(*), 0) AS validInRangePercent,
        avg(humidity) AS humidityAverage, min(humidity) AS humidityMin, max(humidity) AS humidityMax,
        avg(temperature) AS temperatureAverage, min(temperature) AS temperatureMin, max(temperature) AS temperatureMax
        FROM filtered`).get(...args) as unknown as HistoryStatistics
    },
    *exportRows(query: HistoryQuery) {
      // Keep the export snapshot independent from the connection ingesting readings.
      const reader = path === ':memory:' ? db : new DatabaseSync(path, { readOnly: true, timeout: 5000 })
      try {
        const { sql, args } = queryScope(query.filters)
        const rows = reader.prepare(`${sql} SELECT ${columns} FROM filtered ORDER BY ${order(query)}`).iterate(...args)
        yield* rows as unknown as Iterable<StoredRow>
      } finally {
        if (reader !== db) reader.close()
      }
    },
  }
}
