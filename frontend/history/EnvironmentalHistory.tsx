import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { historyPeriods } from '../../shared/history.ts'
import type { HistoryDirection, HistoryPage, HistoryPeriod, HistorySort, HistorySummary } from '../../shared/history.ts'
import type { RegisteredSensor } from '../../shared/telemetry.ts'
import { sensorRequest } from '../sensors/api.ts'
import { historyRequest } from './api.ts'
import { HistoryFilters } from './HistoryFilters.tsx'
import { HistoryOverview } from './HistoryOverview.tsx'
import { HistoryStorage } from './HistoryStorage.tsx'
import { HistoryTable } from './HistoryTable.tsx'
import './history.css'

function useHistoryData<T>(path: string, refresh: number) {
  const [result, setResult] = useState<{ path: string; refresh: number; data?: T; error?: string }>()
  useEffect(() => {
    const controller = new AbortController()
    void historyRequest<T>(path, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ path, refresh, data })
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ path, refresh, error: error.message })
    })
    return () => controller.abort()
  }, [path, refresh])
  return result?.path === path && result.refresh === refresh ? result : undefined
}

export function EnvironmentalHistory() {
  const [params, setParams] = useSearchParams()
  const [refresh, setRefresh] = useState(0)
  const [formVersion, setFormVersion] = useState(0)
  const [sensors, setSensors] = useState<RegisteredSensor[]>([])
  const [sensorError, setSensorError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void sensorRequest<RegisteredSensor[]>('', 'GET', undefined, controller.signal).then(items => {
      if (!controller.signal.aborted) { setSensors(items); setSensorError(false) }
    }).catch(() => { if (!controller.signal.aborted) setSensorError(true) })
    return () => controller.abort()
  }, [refresh])

  const filters = new URLSearchParams()
  for (const key of ['period', 'from', 'to', 'sensor', 'origin', 'condition']) {
    for (const value of params.getAll(key)) filters.append(key, value)
  }
  const period = filters.get('period') ?? 'day'
  const chartPeriod = Object.hasOwn(historyPeriods, period) ? period as HistoryPeriod : 'day'
  const field = params.get('sort')
  const sort: HistorySort = field === 'temperature' || field === 'humidity' ? field : 'time'
  const direction: HistoryDirection = params.get('direction') === 'asc' ? 'asc' : 'desc'
  const tableQuery = new URLSearchParams(filters)
  for (const key of ['sort', 'direction', 'page']) {
    for (const value of params.getAll(key)) tableQuery.append(key, value)
  }
  const summary = useHistoryData<HistorySummary>('/summary?' + filters.toString(), refresh)
  const table = useHistoryData<HistoryPage>('/readings?' + tableQuery.toString(), refresh)
  const exportQuery = new URLSearchParams(tableQuery)
  exportQuery.delete('page')
  const alertQuery = new URLSearchParams({ period: chartPeriod })
  for (const name of ['from', 'to'] as const) {
    const value = filters.get(name)
    if (value && chartPeriod === 'custom') alertQuery.set(name, value)
  }
  const alertSensor = filters.get('sensor') ?? filters.get('origin')
  if (alertSensor) alertQuery.set('sensor', alertSensor)

  function setSort(nextSort: HistorySort) {
    const next = new URLSearchParams(tableQuery)
    next.delete('page')
    next.set('sort', nextSort)
    next.set('direction', sort === nextSort && direction === 'desc' ? 'asc' : 'desc')
    setParams(next)
  }

  return <div className="history-module">
    <header className="history-page-heading">
      <div><h1>Historial ambiental</h1><p>Consulta y exporta las mediciones guardadas del invernadero.</p></div>
      <button className="irrigation-button" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} />Actualizar</button>
    </header>
    <HistoryFilters key={filters.toString() + formVersion} applied={filters} sensors={sensors} apply={next => {
      setFormVersion(value => value + 1)
      setRefresh(value => value + 1)
      setParams(next)
    }} />
    {sensorError && <p className="irrigation-error" role="alert">No se pudieron cargar los sensores disponibles.</p>}
    <HistoryStorage />
    <div className="panel history-section-heading history-alert-context">
      <p>El historial usa los límites actuales. Las alertas conservan el límite vigente al detectarse.</p>
      <Link className="text-link" to={'/alertas?' + alertQuery.toString()}>Alertas del período</Link>
    </div>
    <HistoryOverview summary={summary?.data} error={summary?.error} period={chartPeriod} />
    <HistoryTable data={table?.data} error={table?.error} sort={sort} direction={direction} setSort={setSort}
      setPage={page => { const next = new URLSearchParams(tableQuery); next.set('page', String(page)); setParams(next) }}
      exportUrl={'/api/history/export.csv?' + exportQuery.toString()} />
  </div>
}
