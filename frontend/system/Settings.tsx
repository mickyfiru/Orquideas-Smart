import { useEffect, useState } from 'react'
import { Activity, Bell, Cable, Globe2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { humidityRange, validateEnvironment } from '../../shared/settings.ts'
import type { EnvironmentalSettings } from '../../shared/settings.ts'
import type { NotificationPreferences } from '../../shared/alerts.ts'
import type { Measurement, RegisteredSensor } from '../../shared/telemetry.ts'
import { HistoryStorage } from '../history/HistoryStorage.tsx'
import { useTelemetry } from '../dashboard/useTelemetry.ts'
import { formatReadingTime } from '../dashboard/ClimateChart.tsx'
import { sensorRequest } from '../sensors/api.ts'
import { connectionLabels, formatNumber } from '../sensors/status.ts'
import { browserPermission } from './browserNotifications.ts'
import { systemPut, systemRequest } from './api.ts'
import './system.css'

type General = { version: string; timeZone: string; services: { api: string; database: string }; preferences: NotificationPreferences }
const fields = [
  ['humidityTarget', 'Humedad objetivo (% HR)', 0, 100],
  ['humidityTolerance', 'Tolerancia (puntos porcentuales)', 0, 100],
  ['temperatureMin', 'Temperatura mínima (°C)', -50, 100],
  ['temperatureMax', 'Temperatura máxima (°C)', -50, 100],
  ['staleSeconds', 'Tiempo máximo sin lecturas (s)', 5, 3600],
] as const
const choices = [
  ['environmental', 'Alertas ambientales y de conexión en la aplicación'],
  ['browser', 'Notificaciones del navegador'],
  ['irrigation', 'Recordatorios de riego'],
] as const

export function SettingsPage() {
  const { snapshot, transport, realtime } = useTelemetry(null)
  const [general, setGeneral] = useState<General | null>(null)
  const [physical, setPhysical] = useState<Measurement | null>(null)
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [permission, setPermission] = useState(browserPermission)
  const [draft, setDraft] = useState<Partial<Record<keyof EnvironmentalSettings, string>>>({})
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ section: string; error: boolean; text: string } | null>(null)
  const mode = snapshot?.mode
  const online = transport === 'online'
  const hardwareLatest = mode === 'arduino' ? snapshot?.latest : physical

  useEffect(() => {
    const controller = new AbortController()
    void systemRequest<General>('/settings', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setGeneral(data); setPreferences(data.preferences) }
    }).catch(() => { if (!controller.signal.aborted) setGeneral(null) })
    void sensorRequest<Array<RegisteredSensor & { latest: Measurement | null }>>('', 'GET', undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setPhysical(data.find(item => item.id === 'arduino')?.latest ?? null)
    }).catch(() => {})
    return () => controller.abort()
  }, [mode, transport])

  const values = Object.fromEntries(fields.map(([name]) => [name,
    name in draft && !draft[name]?.trim() ? NaN : Number(draft[name] ?? snapshot?.settings[name]),
  ])) as unknown as EnvironmentalSettings
  const preview = validateEnvironment(values) ? null : humidityRange(values)
  const status = (section: string) => feedback?.section === section
    ? <p className={feedback.error ? 'irrigation-error' : 'irrigation-success'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p> : null

  async function save(section: string, action: () => Promise<void>, message: string) {
    setBusy(true)
    setFeedback(null)
    try { await action(); setFeedback({ section, error: false, text: message }) }
    catch (failure) { setFeedback({ section, error: true, text: (failure as Error).message }) }
    finally { setBusy(false) }
  }

  return <div className="system-module">
    <header className="sensor-page-heading"><div><h1>Configuración</h1><p>Ajusta los umbrales, el registro y los avisos del invernadero.</p></div></header>
    {transport === 'offline' && <p className="notice" role="status">Sin comunicación con el servidor.</p>}
    <div className="settings-grid">
      <section className="panel sensor-card">
        <div className="panel-heading"><span className="tile-icon green"><Activity size={19} /></span><div><h2>Configuración ambiental</h2><p>Estos límites se aplican a las alertas y al monitoreo.</p></div></div>
        <form className="settings-form" onSubmit={event => {
          event.preventDefault()
          const error = validateEnvironment(values)
          if (error) { setFeedback({ section: 'environment', error: true, text: error }); return }
          void save('environment', async () => { await systemPut('/settings/environment', values); setDraft({}) }, 'Límites ambientales guardados.')
        }}>
          <div className="settings-fields">
            {fields.map(([name, label, min, max]) => <label key={name}>{label}
              <input required type="number" min={min} max={max} step={name === 'staleSeconds' ? 1 : 'any'}
                value={draft[name] ?? snapshot?.settings[name] ?? ''} disabled={!online || busy}
                onChange={event => setDraft(previous => ({ ...previous, [name]: event.target.value }))} />
            </label>)}
          </div>
          {preview && <dl className="settings-preview"><div><dt>Humedad aceptable</dt><dd>{formatNumber.format(preview.humidityMin)}–{formatNumber.format(preview.humidityMax)} % HR</dd></div>
            <div><dt>Temperatura aceptable</dt><dd>{formatNumber.format(values.temperatureMin)}–{formatNumber.format(values.temperatureMax)} °C</dd></div></dl>}
          {status('environment')}
          <button className="irrigation-button primary" disabled={!online || busy || !snapshot}>Guardar límites</button>
        </form>
      </section>
      <div className="settings-stack">
        <section className="panel sensor-card">
          <div className="panel-heading"><span className="tile-icon purple"><Bell size={19} /></span><div><h2>Notificaciones</h2><p>Los eventos se guardan independientemente de estas preferencias.</p></div></div>
          <div className="settings-switches">
            {choices.map(([name, label]) =>
              <label key={name}><input type="checkbox" checked={preferences?.[name] ?? false} disabled={!preferences || !online || busy}
                onChange={event => setPreferences(previous => previous ? { ...previous, [name]: event.target.checked } : previous)} />{label}</label>)}
          </div>
          <p className="sensor-help">Los avisos del navegador se entregan con la aplicación abierta y permiso concedido.</p>
          <div className="history-actions settings-actions">
            <button className="irrigation-button primary" disabled={!preferences || !online || busy} onClick={() => {
              if (preferences) void save('notices', async () => setPreferences(await systemPut<NotificationPreferences>('/settings/notifications', preferences)), 'Preferencias guardadas.')
            }}>Guardar avisos</button>
            {permission === 'default' && <button className="irrigation-button" onClick={async () => {
              try { setPermission(await Notification.requestPermission()) }
              catch { setFeedback({ section: 'notices', error: true, text: 'El navegador no pudo solicitar permiso.' }) }
            }}>Solicitar permiso</button>}
          </div>
          {permission === 'denied' && <p className="sensor-help">Permiso del navegador bloqueado.</p>}
          {permission === 'granted' && <p className="sensor-help">Permiso del navegador concedido.</p>}
          {status('notices')}
        </section>
        <HistoryStorage />
      </div>
      <section className="panel sensor-card">
        <div className="panel-heading"><span className="tile-icon green"><Cable size={19} /></span><div><h2>Hardware</h2><p>Arduino UNO R3 con sensor DHT11</p></div></div>
        <dl className="system-list">
          <div><dt>Modo activo</dt><dd>{mode === 'arduino' ? 'Arduino' : mode === 'simulation' ? 'Simulación' : '—'}</dd></div>
          <div><dt>Puerto serie</dt><dd>{snapshot?.serial.path ?? 'Sin seleccionar'}</dd></div>
          <div><dt>Conexión Arduino</dt><dd>{!online ? 'Sin conexión con el servidor' : mode === 'simulation' ? 'Inactivo' : snapshot && connectionLabels[snapshot.connection]}</dd></div>
          <div><dt>Última lectura válida del DHT11</dt><dd>{hardwareLatest ? `${formatNumber.format(hardwareLatest.humidity)} % HR · ${formatNumber.format(hardwareLatest.temperature)} °C` : 'Sin registro'}
            {hardwareLatest && <small>{formatReadingTime(hardwareLatest.time)}</small>}</dd></div>
        </dl>
        <Link className="text-link" to="/sensores">Administrar conexión en Sensores</Link>
      </section>
      <section className="panel sensor-card">
        <div className="panel-heading"><span className="tile-icon blue"><Globe2 size={19} /></span><div><h2>General</h2><p>Información y estado de los servicios</p></div></div>
        <dl className="system-list">
          <div><dt>Zona horaria</dt><dd>{general?.timeZone ?? 'America/Santiago'}</dd></div>
          <div><dt>Versión</dt><dd>{general?.version ?? '—'}</dd></div>
          <div><dt>API</dt><dd>{general?.services.api === 'online' && online ? 'Disponible' : 'Sin confirmar'}</dd></div>
          <div><dt>SQLite</dt><dd>{general?.services.database === 'online' && online ? 'Disponible' : 'Sin confirmar'}</dd></div>
          <div><dt>WebSocket</dt><dd>{realtime ? 'En línea' : transport === 'loading' ? 'Consultando…' : 'Sin conexión en vivo'}</dd></div>
        </dl>
      </section>
    </div>
  </div>
}
