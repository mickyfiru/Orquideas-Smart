import type { Measurement, Mode } from './telemetry.ts'

export const historyPeriods = { day: 'Últimas 24 horas', week: 'Últimos 7 días', month: 'Últimos 30 días', custom: 'Intervalo personalizado' } as const
export const storageIntervals = [1, 5, 15, 30, 60] as const
export const originLabels: Record<Mode, string> = { arduino: 'Arduino', simulation: 'Simulación' }
export const sensorIdentifiers: Record<Mode, string> = { arduino: 'DHT11-01', simulation: 'SIM-01' }

export type HistoryPeriod = keyof typeof historyPeriods
export type HistoryCondition = 'normal' | 'out'
export type HistorySort = 'time' | 'humidity' | 'temperature'
export type HistoryDirection = 'asc' | 'desc'

export interface HistoryReading extends Measurement {
  sensorId: Mode
  origin: Mode
  condition: HistoryCondition
  valid: true
}

export interface HistoryPage {
  rows: HistoryReading[]
  total: number
  page: number
  pageSize: number
}

export interface HistoryStatistics {
  total: number
  outOfRange: number
  validInRangePercent: number | null
  humidityAverage: number | null
  humidityMin: number | null
  humidityMax: number | null
  temperatureAverage: number | null
  temperatureMin: number | null
  temperatureMax: number | null
}

export interface HistorySummary {
  statistics: HistoryStatistics
  series: Array<{ origin: Mode; total: number; points: Measurement[] }>
  storageMinutes: number
}
