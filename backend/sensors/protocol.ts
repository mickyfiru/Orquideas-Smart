import type { Measurement } from '../../shared/telemetry.ts'

export const sensorId = 'DHT11-01'
export const baudRate = 9600
export const maxLineBytes = 512
type Packet = { kind: 'reading'; reading: Measurement } | { kind: 'sensor-error' } | { kind: 'invalid' }

export function parseSensorLine(line: string, receivedAt: number): Packet {
  if (line.length > maxLineBytes) return { kind: 'invalid' }
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { kind: 'invalid' }
  }
  if (!value || typeof value !== 'object') return { kind: 'invalid' }
  const packet = value as Record<string, unknown>
  if (packet.sensorId !== sensorId) return { kind: 'invalid' }
  if (packet.status === 'error' && packet.code === 'DHT_READ_FAILED') return { kind: 'sensor-error' }
  const { humidity, temperature } = packet
  if (packet.status !== 'ok' || typeof humidity !== 'number' || typeof temperature !== 'number'
    || !Number.isFinite(humidity) || !Number.isFinite(temperature)
    || humidity < 0 || humidity > 100 || temperature < 0 || temperature > 50) {
    return { kind: 'invalid' }
  }
  return { kind: 'reading', reading: { humidity, temperature, time: receivedAt } }
}
