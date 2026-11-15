import { sampleInterval, staleAfter } from '../shared/telemetry.ts'
import type { Connection, Measurement, Mode } from '../shared/telemetry.ts'

export interface AcquisitionSource {
  readonly mode: Mode
  readonly connected: boolean
  start(publish: (reading: Measurement) => void, changed?: () => void): () => void | Promise<void>
}

export function simulatedReading(time: number): Measurement {
  const day = time / 86_400_000 * 2 * Math.PI
  const wave = Math.sin(day)
  const variation = Math.sin(time / 34_000)
  return {
    time,
    humidity: Math.round((80 - 6 * wave + 2 * Math.cos(day / 3) + variation) * 10) / 10,
    temperature: Math.round((21.1 + 2.2 * wave + .35 * Math.sin(day / 2) + .25 * variation) * 10) / 10,
  }
}

export function getConnection(mode: Mode, connected: boolean, latest: Measurement | null, now: number, maximumAge = staleAfter): Connection {
  if (!connected) return 'disconnected'
  if (!latest) return 'empty'
  if (now - latest.time > maximumAge) return 'stale'
  return mode === 'simulation' ? 'simulation' : 'connected'
}

export const simulation: AcquisitionSource = {
  mode: 'simulation',
  connected: true,
  start(publish) {
    const tick = () => publish(simulatedReading(Date.now()))
    tick()
    const timer = setInterval(tick, sampleInterval)
    return () => clearInterval(timer)
  },
}

export const offlineArduino: AcquisitionSource = {
  mode: 'arduino',
  connected: false,
  start: () => () => {},
}
