import type { Mode } from './telemetry.ts'

export const alertLabels = {
  humidity_low: 'Humedad baja', humidity_high: 'Humedad alta', temperature_low: 'Temperatura baja', temperature_high: 'Temperatura alta',
  disconnected: 'Arduino desconectado', no_response: 'Sensor sin respuesta', stale: 'Mediciones desactualizadas', communication: 'Error de comunicación',
} as const
export type AlertType = keyof typeof alertLabels
export type Severity = 'warning' | 'critical'
export const severityLabels: Record<Severity, string> = { warning: 'Advertencia', critical: 'Crítica' }
export const isConnectionAlert = (type: AlertType) => ['disconnected', 'no_response', 'stale', 'communication'].includes(type)

export interface AlertEvent {
  id: number
  sensor: Mode
  type: AlertType
  severity: Severity
  value: number | null
  threshold: number | null
  detail: string | null
  createdAt: number
  resolvedAt: number | null
  readAt: number | null
}

export interface AlertPage { rows: AlertEvent[]; total: number; page: number; pageSize: number }
export interface NotificationPreferences { environmental: boolean; browser: boolean; irrigation: boolean }
export interface NotificationItem {
  kind: 'environment' | 'connection' | 'irrigation'
  id: number
  title: string
  detail: string
  time: number
  scheduledAt?: number
  readAt: number | null
}
export interface NotificationInbox {
  items: NotificationItem[]
  recent: NotificationItem[]
  unread: number
  preferences: NotificationPreferences
}
