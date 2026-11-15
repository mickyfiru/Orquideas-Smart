import type { AlertType } from '../../shared/alerts.ts'
import type { DashboardSnapshot } from '../../shared/telemetry.ts'
import type { createAlertStore, Occurrence } from './store.ts'

type Trigger = 'reading' | 'state' | 'settings'

export function createAlertEngine(store: ReturnType<typeof createAlertStore>) {
  let mode: DashboardSnapshot['mode'] | undefined
  let openedAt: number | null = null
  let hasOpened = false
  const recovering = new Map<AlertType, { count: number; time: number }>()

  return (snapshot: DashboardSnapshot, now: number, trigger: Trigger) => {
    let changed = false
    if (mode !== snapshot.mode) {
      mode = snapshot.mode
      changed = store.resolveOther(mode, now)
      openedAt = null
      hasOpened = false
      recovering.clear()
    }
    const { connection, conditions, latest, settings, serial } = snapshot
    const current = new Map(store.active(mode).map(event => [event.type, event]))
    const open: Occurrence[] = []
    const close: AlertType[] = []
    const present = (type: AlertType, exists: boolean, value: number | null, threshold: number | null, detail: string | null) => {
      if (exists && !current.has(type)) {
        const severity = type === 'humidity_low' || type === 'humidity_high' || type === 'stale' || type === 'communication' ? 'warning' : 'critical'
        open.push({ type, severity, value, threshold, detail })
      }
      if (!exists && current.has(type)) close.push(type)
    }
    const limits = [
      ['humidity_low', conditions.humidity, 'low', latest?.humidity, conditions.humidityMin],
      ['humidity_high', conditions.humidity, 'high', latest?.humidity, conditions.humidityMax],
      ['temperature_low', conditions.temperature, 'low', latest?.temperature, settings.temperatureMin],
      ['temperature_high', conditions.temperature, 'high', latest?.temperature, settings.temperatureMax],
    ] as const
    for (const [type, level, limit, value, threshold] of limits) {
      if (!latest || value === undefined || level === 'unavailable') {
        recovering.delete(type)
        continue
      }
      if (level === limit) {
        recovering.delete(type)
        present(type, true, value, threshold, null)
      } else if (current.has(type)) {
        const previous = recovering.get(type)
        if (trigger === 'reading' && previous?.time !== latest.time) {
          recovering.set(type, { time: latest.time, count: (previous?.count ?? 0) + 1 })
        }
        if (trigger === 'settings' || (recovering.get(type)?.count ?? 0) >= 2) {
          close.push(type)
          recovering.delete(type)
        }
      }
    }

    const arduino = mode === 'arduino'
    const openLink = arduino && (serial.state === 'open' || connection === 'connected' || connection === 'empty' || connection === 'stale')
    if (openLink && openedAt === null) { openedAt = now; hasOpened = true }
    if (!openLink) openedAt = null
    const since = Math.max(openedAt ?? now, serial.lastCommunication ?? 0, latest?.time ?? 0)
    const silentSeconds = Math.max(0, Math.floor((now - since) / 1000))
    const sensorFault = serial.errorKind === 'sensor'
    present('disconnected', arduino && !openLink && (hasOpened || current.has('disconnected')), null, null, serial.path)
    present('no_response', openLink && (sensorFault || (silentSeconds > settings.staleSeconds && !latest)),
      sensorFault ? null : silentSeconds, sensorFault ? null : settings.staleSeconds, sensorFault ? serial.error : null)
    present('stale', connection === 'stale' && Boolean(latest && now - latest.time > settings.staleSeconds * 1000) && !sensorFault,
      latest ? Math.max(0, Math.floor((now - latest.time) / 1000)) : null, settings.staleSeconds, null)
    present('communication', arduino && serial.errorKind === 'communication', null, null, serial.error)

    return open.length || close.length ? store.update(mode, open, close, now) || changed : changed
  }
}
