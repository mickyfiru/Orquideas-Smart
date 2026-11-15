import { useState } from 'react'
import { CalendarDays, CircuitBoard, Clock3, Droplets, FlaskConical, Radio, Thermometer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Connection, Range } from '../../shared/telemetry.ts'
import { ClimateChart, formatReadingTime, rangeLabels } from './ClimateChart.tsx'
import { useTelemetry } from './useTelemetry.ts'
import orchids from '../assets/orquideas.jpg'
import { irrigationDate } from '../irrigation/api.ts'

const statusLabels: Record<Connection | 'loading', string> = {
  connected: 'Conectado',
  disconnected: 'Desconectado',
  empty: 'Sin lecturas',
  stale: 'Datos desactualizados',
  simulation: 'Modo simulación',
  loading: 'Consultando estado',
}
const number = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 })

function Metric({ icon: Icon, tone, title, value, unit, detail, irrigation }: {
  icon: LucideIcon
  tone: string
  title: string
  value: string
  unit?: string
  detail?: string
  irrigation?: boolean
}) {
  return (
    <article className="panel metric">
      <span className={`tile-icon ${tone}`}><Icon size={20} /></span>
      <h2>{title}</h2>
      <div className={irrigation ? 'metric-value irrigation-date-value' : 'metric-value'}>{value}{unit && <span>{unit}</span>}</div>
      {detail && <p>{detail}</p>}
      {irrigation && <Link className="text-link" to="/calendario">Ver calendario</Link>}
    </article>
  )
}

export function Dashboard() {
  const [range, setRange] = useState<Range>('day')
  const { snapshot, transport, lastUpdate, points, chartError } = useTelemetry(range)
  const latest = snapshot?.latest
  const status = transport === 'offline' ? 'disconnected' : snapshot?.connection ?? 'loading'
  const simulated = snapshot?.mode === 'simulation'
  const settings = snapshot?.settings
  const readingTime = latest ? formatReadingTime(latest.time) : 'Sin lecturas'
  const source = simulated ? 'Simulador ambiental' : snapshot ? 'Arduino UNO R3 · DHT11' : '—'
  return (
    <>
      <section className="hero">
        <img className="hero-photo" src={orchids} alt="" fetchPriority="high" />
        <div className="hero-content">
          <span className="hero-label"><span /> INVERNADERO DE ORQUÍDEAS</span>
          <h1>Panel de monitoreo</h1>
          <p>Consulta las condiciones de cultivo de tu invernadero.</p>
        </div>
      </section>

      <div className="overview">
        <div className="overview-title">
          <h2>Resumen ambiental</h2>
          {simulated && status !== 'simulation' && <span className="status-pill simulation"><i />Modo simulación</span>}
          <span className={`status-pill ${status}`} role="status"><i />{statusLabels[status]}</span>
        </div>
        <span className="updated"><Clock3 size={15} /> {latest ?
          `${snapshot?.conditions.stale || transport === 'offline' ? 'Lectura desactualizada' : 'Última lectura'} · ${readingTime}` : 'Sin lecturas registradas'}</span>
      </div>

      {transport === 'offline' && <p className="notice" role="status">Se perdió la conexión con el servidor. {latest ? 'Se muestra la última lectura disponible.' : 'Los datos aparecerán al restablecerse la conexión.'}</p>}

      <section className="metrics" aria-label="Indicadores ambientales">
        <Metric icon={Droplets} tone="green" title="Humedad ambiental" value={latest ? number.format(latest.humidity) : '—'}
          unit={latest ? '%' : undefined} detail={settings ? `Objetivo: ${settings.humidityTarget} % HR` : 'Humedad relativa'} />
        <Metric icon={Thermometer} tone="purple" title="Temperatura actual" value={latest ? number.format(latest.temperature) : '—'}
          unit={latest ? '°C' : undefined} detail={settings ? `Rango: ${settings.temperatureMin}–${settings.temperatureMax} °C` : 'Temperatura ambiental'} />
        <Metric icon={CircuitBoard} tone="blue" title="Sensores conectados"
          value={snapshot && transport === 'online' ? String(snapshot.connectedSensors) : '—'}
          detail={snapshot ? `${snapshot.physicalSensors} dispositivo físico configurado` : 'Dispositivos físicos'} />
        <Metric icon={CalendarDays} tone="amber" title="Próximo riego" irrigation
          value={transport === 'offline' ? 'Sin conexión' : !snapshot ? 'Consultando…' :
            snapshot.nextIrrigation !== null ? irrigationDate.format(snapshot.nextIrrigation) : 'Sin riegos programados'} />
      </section>

      <section className="panel dashboard-alert-status" aria-label="Estado ambiental y alertas">
        <div><strong>Estado ambiental</strong><span className="status-pill">
          {transport !== 'online' || !snapshot || snapshot.conditions.humidity === 'unavailable'
            ? 'Sin evaluación actual' : snapshot.conditions.humidity === 'normal' && snapshot.conditions.temperature === 'normal' ? 'En rango' : 'Fuera de rango'}
        </span></div>
        <div><strong>Comunicación</strong><span className={`status-pill ${status}`}>{status === 'simulation' ? 'Simulador en línea' : statusLabels[status]}</span></div>
        <div><strong>Alertas activas</strong><span>{transport === 'online' ? snapshot?.activeAlerts ?? '—' : '—'}</span></div>
        <Link to="/alertas?status=active" className="text-link">Ver historial de alertas</Link>
      </section>
      <div className="details-grid">
        <section className="panel climate">
          <div className="panel-heading dashboard-chart-heading">
            <div><h2>Condiciones ambientales</h2><p>{simulated ? 'Lecturas de humedad y temperatura simuladas' : 'Lecturas de humedad y temperatura'}</p></div>
            <Link className="text-link" to={`/historial?period=${range === 'live' ? 'day' : range}${snapshot ? '&origin=' + snapshot.mode : ''}`}>Ver historial completo</Link>
          </div>
          <div className="chart-controls">
            <div className="filters" role="group" aria-label="Rango del gráfico">
              {(Object.keys(rangeLabels) as Range[]).map(key => (
                <button key={key} aria-pressed={key === range} onClick={() => setRange(key)}>{rangeLabels[key]}</button>
              ))}
            </div>
            <div className="legend" aria-hidden="true"><span>Humedad</span><span>Temperatura</span></div>
          </div>
          {chartError && <p className="chart-error" role="status">No se pudo actualizar el gráfico.</p>}
          {points?.length ? <ClimateChart points={points} range={range} /> :
            <div className="chart-empty">{chartError ? 'Gráfico no disponible' : points ? 'No hay lecturas en este período.' : 'Cargando lecturas…'}</div>}
        </section>
        <section className="panel system">
          <div className="panel-heading">
            <span className="tile-icon green"><Radio size={21} /></span>
            <div><h2>Estado del sistema</h2><p>Fuente de las mediciones</p></div>
          </div>
          <dl className="system-list">
            <div><dt>Origen de datos</dt><dd>{source}</dd></div>
            <div><dt>Servidor</dt><dd>{transport === 'online' ? 'En línea' : transport === 'offline' ? 'Sin conexión' : 'Consultando…'}</dd></div>
            <div><dt>Intervalo de guardado</dt><dd>{settings ? `${settings.storageMinutes} min` : '—'}</dd></div>
            <div><dt>Última respuesta</dt><dd>{lastUpdate ? formatReadingTime(lastUpdate) : '—'}</dd></div>
          </dl>
          {simulated && <div className="simulation-note"><FlaskConical size={18} /><div><strong>Datos de prueba</strong><p>Las lecturas se generan en el servidor. El conteo de sensores refleja únicamente dispositivos físicos.</p></div></div>}
        </section>
      </div>
    </>
  )
}
