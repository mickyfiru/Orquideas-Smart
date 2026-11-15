export const ranges = {
  live: 15 * 60_000,
  day: 24 * 3_600_000,
  week: 7 * 24 * 3_600_000,
  month: 30 * 24 * 3_600_000,
} as const

export type Range = keyof typeof ranges
export type Mode = 'simulation' | 'arduino'
export type Connection = 'connected' | 'disconnected' | 'empty' | 'stale' | 'simulation'
export const sampleInterval = 5_000
export const staleAfter = 20_000

export interface Measurement {
  time: number
  humidity: number
  temperature: number
}

export interface SerialPortOption {
  path: string
  manufacturer: string | null
  arduinoCandidate: boolean
}

export interface SerialStatus {
  path: string | null
  state: 'closed' | 'opening' | 'open'
  confirmed: boolean
  hasReading: boolean
  lastCommunication: number | null
  error: string | null
  errorKind?: 'communication' | 'sensor'
}

export interface RegisteredSensor {
  id: Mode
  name: string
  type: string
  controller: string | null
}

export type EnvironmentalLevel = 'normal' | 'low' | 'high' | 'unavailable'

export interface EnvironmentalStatus {
  humidity: EnvironmentalLevel
  temperature: EnvironmentalLevel
  stale: boolean
  humidityMin: number
  humidityMax: number
}

export interface DashboardSnapshot {
  mode: Mode
  connection: Connection
  latest: Measurement | null
  connectedSensors: number
  physicalSensors: number
  nextIrrigation: number | null
  irrigationRevision: string
  alertsRevision: string
  activeAlerts: number
  serial: SerialStatus
  conditions: EnvironmentalStatus
  settings: EnvironmentalSettings & { storageMinutes: number }
}

export function evaluateEnvironment(
  reading: Measurement | null,
  connection: Connection,
  settings: EnvironmentalLimits,
): EnvironmentalStatus {
  const { humidityMin, humidityMax } = humidityRange(settings)
  const stale = Boolean(reading && connection !== 'connected' && connection !== 'simulation')
  const level = (value: number, min: number, max: number): EnvironmentalLevel =>
    value < min ? 'low' : value > max ? 'high' : 'normal'
  const current = reading && !stale
  return {
    humidityMin, humidityMax, stale,
    humidity: current ? level(reading.humidity, humidityMin, humidityMax) : 'unavailable',
    temperature: current ? level(reading.temperature, settings.temperatureMin, settings.temperatureMax) : 'unavailable',
  }
}
import { humidityRange } from './settings.ts'
import type { EnvironmentalLimits, EnvironmentalSettings } from './settings.ts'

