import { Temporal } from '@js-temporal/polyfill'
import { historyPeriods, originLabels } from '../../shared/history.ts'
import type { HistoryCondition, HistoryDirection, HistoryPeriod, HistorySort } from '../../shared/history.ts'
import { irrigationZone } from '../../shared/irrigation.ts'
import { ranges } from '../../shared/telemetry.ts'
import type { Mode, RegisteredSensor } from '../../shared/telemetry.ts'

export class HistoryQueryError extends Error {}

export interface HistoryFilters {
  from: number
  until: number
  sensor?: Mode
  origin?: Mode
  condition?: HistoryCondition
}
export interface HistoryQuery {
  filters: HistoryFilters
  sort: HistorySort
  direction: HistoryDirection
  page: number
  pageSize: number
}

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') {
    throw new HistoryQueryError('Usa fechas válidas en formato AAAA-MM-DD.')
  }
  try {
    return Temporal.PlainDate.from(value)
  } catch {
    throw new HistoryQueryError('El intervalo de fechas contiene un día inválido.')
  }
}

export function parseHistoryQuery(query: Record<string, unknown>, now: number, sensors: RegisteredSensor[]): HistoryQuery {
  const field = (key: string) => {
    const value = query[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw new HistoryQueryError('Los filtros deben tener un solo valor.')
    return value || undefined
  }

  const start = field('from')
  const end = field('to')
  const period = field('period') ?? (start || end ? 'custom' : 'day')
  if (!Object.hasOwn(historyPeriods, period)) throw new HistoryQueryError('Selecciona un período válido.')

  let until = now + 1
  let from: number
  if (period === 'custom') {
    if (!start || !end) throw new HistoryQueryError('Indica la fecha inicial y final.')
    const first = date(start)
    const last = date(end)
    if (Temporal.PlainDate.compare(first, last) > 0) throw new HistoryQueryError('La fecha inicial debe ser anterior o igual a la final.')
    from = first.toZonedDateTime(irrigationZone).epochMilliseconds
    until = last.add({ days: 1 }).toZonedDateTime(irrigationZone).epochMilliseconds
  } else {
    if (start || end) throw new HistoryQueryError('Selecciona un intervalo personalizado para usar fechas.')
    from = now - ranges[period as Exclude<HistoryPeriod, 'custom'>]
  }

  const sensor = field('sensor')
  if (sensor && !sensors.some(item => item.id === sensor)) throw new HistoryQueryError('Selecciona un sensor registrado.')
  const origin = field('origin')
  if (origin && !Object.hasOwn(originLabels, origin)) throw new HistoryQueryError('Selecciona un origen válido.')
  const condition = field('condition')
  if (condition !== undefined && condition !== 'normal' && condition !== 'out') throw new HistoryQueryError('Selecciona una condición válida.')
  const sort = field('sort') ?? 'time'
  if (sort !== 'time' && sort !== 'humidity' && sort !== 'temperature') throw new HistoryQueryError('Selecciona un campo de orden válido.')
  const direction = field('direction') ?? 'desc'
  if (direction !== 'asc' && direction !== 'desc') throw new HistoryQueryError('Selecciona un orden válido.')

  function positiveInteger(key: string, defaultValue: number, maximum: number) {
    const value = field(key)
    if (!value) return defaultValue
    const parsed = Number(value)
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(parsed) || parsed > maximum) {
      throw new HistoryQueryError('La paginación solicitada no es válida.')
    }
    return parsed
  }

  return {
    filters: { from, until, sensor: sensor as Mode | undefined, origin: origin as Mode | undefined, condition },
    sort, direction, page: positiveInteger('page', 1, 1_000_000_000), pageSize: positiveInteger('pageSize', 25, 100),
  }
}
