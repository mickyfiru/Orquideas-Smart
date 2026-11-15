import { Activity, CircleCheck, Droplets, Thermometer } from 'lucide-react'
import { originLabels } from '../../shared/history.ts'
import type { HistoryPeriod, HistorySummary } from '../../shared/history.ts'
import { ClimateChart } from '../dashboard/ClimateChart.tsx'
import { formatNumber } from '../sensors/status.ts'

const value = (number: number | null, unit = '') => number === null ? '—' : formatNumber.format(number) + unit

export function HistoryOverview({ summary, error, period }: { summary?: HistorySummary; error?: string; period: HistoryPeriod }) {
  if (error || !summary?.statistics.total) return <section className="panel history-overview">
    <div className="history-section-heading"><div><h2>Resumen del período</h2><p>Estadísticas y gráficos de las lecturas guardadas</p></div></div>
    {error ? <p className="irrigation-error" role="alert">{error}</p> :
      <p className="history-empty">{summary ? 'Sin datos para calcular estadísticas o trazar gráficos.' : 'Cargando resumen…'}</p>}
  </section>

  const stats = summary.statistics
  const tiles = [
    { Icon: Droplets, tone: 'green', title: 'Humedad promedio', result: value(stats.humidityAverage, ' %'), detail: `Mín. ${value(stats.humidityMin, ' %')} · Máx. ${value(stats.humidityMax, ' %')}` },
    { Icon: Thermometer, tone: 'purple', title: 'Temperatura promedio', result: value(stats.temperatureAverage, ' °C'), detail: `Mín. ${value(stats.temperatureMin, ' °C')} · Máx. ${value(stats.temperatureMax, ' °C')}` },
    { Icon: Activity, tone: 'blue', title: 'Mediciones', result: value(stats.total), detail: `${value(stats.outOfRange)} fuera de rango` },
    { Icon: CircleCheck, tone: 'amber', title: 'Lecturas válidas en rango', result: value(stats.validInRangePercent, ' %'), detail: 'Según los parámetros actuales' },
  ]

  return <>
    <section className="history-statistics" aria-label="Estadísticas de las mediciones">
      {tiles.map(({ Icon, tone, title, result, detail }) => <article className="panel" key={title}>
        <span className={`tile-icon ${tone}`}><Icon size={19} /></span>
        <h2>{title}</h2><strong>{result}</strong><p>{detail}</p>
      </article>)}
    </section>
    <div className="history-charts">
      {summary.series.map(series => <section className="panel climate" key={series.origin}>
        <div className="history-section-heading">
          <div><h2>Humedad y temperatura</h2><p>{value(series.total)} {series.total === 1 ? 'medición guardada' : 'mediciones guardadas'}</p></div>
          <span className={`status-pill ${series.origin === 'simulation' ? 'simulation' : 'connected'}`}><i />{originLabels[series.origin]}</span>
        </div>
        <div className="legend history-chart-legend" aria-hidden="true"><span>Humedad</span><span>Temperatura</span></div>
        <ClimateChart points={series.points} range={period} simulated={series.origin === 'simulation'} />
        {series.points.length < series.total && <p className="history-chart-caption">Se muestran {series.points.length} puntos del período. El CSV incluye todas las mediciones filtradas.</p>}
      </section>)}
    </div>
  </>
}
