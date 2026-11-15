import { useState } from 'react'
import { Activity, CircleAlert, Clock3, Droplets, Thermometer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { EnvironmentalLevel, Range } from '../../shared/telemetry.ts'
import { ClimateChart, formatReadingTime, rangeLabels } from '../dashboard/ClimateChart.tsx'
import { useTelemetry } from '../dashboard/useTelemetry.ts'
import { sensorRequest } from './api.ts'
import { connectionLabels, formatNumber } from './status.ts'
import './sensors.css'

function ReadingCard({ Icon, color, title, value, unit, level, subtitle }: {
  Icon: LucideIcon; color: string; title: string; value: number | undefined; unit: string; level: EnvironmentalLevel; subtitle: string
}) {
  const label = level === 'low' ? 'Crítica · baja' : level === 'high' ? 'Crítica · alta' : level === 'normal' ? 'Normal' : 'Sin evaluación actual'
  return <article className="panel sensor-card environmental-card">
    <div className="sensor-card-heading"><span className={`tile-icon ${color}`}><Icon size={20} /></span>
      <span className={`status-pill ${level === 'normal' ? 'connected' : level === 'unavailable' ? '' : 'stale'}`}><i />{label}</span></div>
    <h2>{title}</h2>
    <div className="metric-value">{value === undefined ? '—' : formatNumber.format(value)}{value !== undefined && <span>{unit}</span>}</div>
    <p>{subtitle}</p>
  </article>
}

export function Monitoring() {
  const [range, setRange] = useState<Range>('live')
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const { snapshot, transport, points, chartError } = useTelemetry(range)
  const settings = snapshot?.settings
  const latest = snapshot?.latest
  const conditions = snapshot?.conditions
  const simulated = snapshot?.mode === 'simulation'
  const online = transport === 'online'
  const warning = transport === 'offline' ? 'Se perdió la comunicación con el servidor.'
    : snapshot?.connection === 'disconnected' ? 'Sensor desconectado.'
      : snapshot?.connection === 'stale' ? 'No se han recibido mediciones recientes.'
        : snapshot?.connection === 'empty' ? 'Arduino identificado. Aún no hay lecturas válidas.' : null
  const humidityLevel = online ? conditions?.humidity ?? 'unavailable' : 'unavailable'
  const temperatureLevel = online ? conditions?.temperature ?? 'unavailable' : 'unavailable'
  const critical = [humidityLevel, temperatureLevel].some(level => level === 'low' || level === 'high')

  return <div className="sensor-module">
    <header className="sensor-page-heading">
      <div><h1>Monitoreo ambiental</h1><p>Humedad relativa del aire y temperatura del invernadero.</p></div>
      {snapshot && <span className={`status-pill ${online ? snapshot.connection : 'disconnected'}`}><i />{online ? connectionLabels[snapshot.connection] : 'Sin conexión'}</span>}
    </header>
    {warning && <p className="notice" role="status">{warning} {latest && 'La última lectura se muestra como dato desactualizado.'}</p>}
    {snapshot?.serial.error && !simulated && <p className="notice" role="status">{snapshot.serial.error}</p>}
    {critical && <div className="sensor-critical" role="status"><CircleAlert size={19} /><div><strong>Condiciones fuera de rango</strong>
      <p>{[humidityLevel === 'low' ? 'Humedad por debajo del rango.' : humidityLevel === 'high' ? 'Humedad por encima del rango.' : '',
        temperatureLevel === 'low' ? 'Temperatura por debajo del rango.' : temperatureLevel === 'high' ? 'Temperatura por encima del rango.' : ''].filter(Boolean).join(' ')}</p></div></div>}
    <div className="sensor-controls">
      <ReadingCard Icon={Droplets} color="green" title="Humedad relativa" value={latest?.humidity} unit="% HR"
        level={humidityLevel} subtitle={conditions && settings ? `Objetivo ${settings.humidityTarget} % HR · Rango ${formatNumber.format(conditions.humidityMin)}–${formatNumber.format(conditions.humidityMax)} % HR` : 'Consultando rangos…'} />
      <ReadingCard Icon={Thermometer} color="purple" title="Temperatura ambiental" value={latest?.temperature} unit="°C"
        level={temperatureLevel} subtitle={settings ? `Rango ${settings.temperatureMin}–${settings.temperatureMax} °C` : 'Consultando rangos…'} />
    </div>
    <div className="monitoring-grid">
      <section className="panel climate">
        <div className="panel-heading"><div><h2>Mediciones ambientales</h2><p>{!snapshot ? 'Consultando origen…' : simulated ? 'Datos simulados' : 'Arduino UNO R3 · DHT11'}{range === 'live' && ' · Últimos 15 minutos'}</p></div></div>
        <div className="chart-controls">
          <div className="filters" role="group" aria-label="Rango del gráfico">
            {(Object.keys(rangeLabels) as Range[]).map(key => <button key={key} aria-pressed={range === key} onClick={() => setRange(key)}>{rangeLabels[key]}</button>)}
          </div>
          <div className="legend" aria-hidden="true"><span>Humedad</span><span>Temperatura</span></div>
        </div>
        {chartError && <p className="chart-error" role="status">No se pudo actualizar el gráfico.</p>}
        {points?.length ? <ClimateChart points={points} range={range} /> :
          <div className="chart-empty">{chartError || transport === 'offline' ? 'Gráfico no disponible' : points ? 'No hay lecturas en este período.' : 'Cargando lecturas…'}</div>}
      </section>
      <section className="panel sensor-card">
        <div className="panel-heading"><span className="tile-icon green"><Activity size={20} /></span><div><h2>Rangos ambientales</h2>
          <p>Ajusta el margen aceptable de humedad relativa.</p></div></div>
        <form className="irrigation-form tolerance-form" onSubmit={async event => {
          event.preventDefault()
          const raw = draft ?? String(settings?.humidityTolerance ?? '')
          const value = Number(raw)
          if (!raw.trim() || !Number.isFinite(value) || value < 0 || value > 100) { setError('Ingresa un valor de 0 a 100.'); return }
          setError('')
          setSaved(false)
          setBusy(true)
          try {
            await sensorRequest('/humidity-tolerance', 'PUT', { value })
            setDraft(null)
            setSaved(true)
          } catch (failure) {
            setError((failure as Error).message)
          } finally {
            setBusy(false)
          }
        }}>
          <label>Tolerancia (puntos porcentuales)
            <input inputMode="decimal" type="number" min="0" max="100" step="any" required value={draft ?? settings?.humidityTolerance ?? ''}
              disabled={!online || busy} onChange={event => { setDraft(event.target.value); setSaved(false) }} />
          </label>
          <button className="irrigation-button primary" disabled={!online || busy}>Guardar tolerancia</button>
          {saved && <p className="irrigation-success" role="status">Tolerancia actualizada.</p>}
          {error && <p className="irrigation-error" role="alert">{error}</p>}
        </form>
        <p className="sensor-reading-time"><Clock3 size={15} />{latest ? `Última lectura · ${formatReadingTime(latest.time)}` : 'Sin lecturas registradas'}</p>
      </section>
    </div>
  </div>
}
