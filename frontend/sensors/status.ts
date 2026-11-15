import type { Connection } from '../../shared/telemetry.ts'

export const connectionLabels: Record<Connection, string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  empty: 'Sin lecturas',
  stale: 'Datos desactualizados',
  simulation: 'Modo simulación',
}
export const formatNumber = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 })
