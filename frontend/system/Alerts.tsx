import { useEffect, useState } from 'react'
import { Bell, Check, ChevronLeft, ChevronRight, CircleAlert, Usb } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { alertLabels, isConnectionAlert, severityLabels } from '../../shared/alerts.ts'
import type { AlertPage, AlertType } from '../../shared/alerts.ts'
import { historyPeriods, originLabels, sensorIdentifiers } from '../../shared/history.ts'
import { formatReadingTime } from '../dashboard/ClimateChart.tsx'
import { subscribeTelemetry } from '../telemetrySocket.ts'
import { formatNumber } from '../sensors/status.ts'
import { systemRequest } from './api.ts'
import './system.css'

function units(type: AlertType) {
  if (type.startsWith('humidity')) return '% HR'
  if (type.startsWith('temperature')) return '°C'
  return 's'
}
const displayValue = (value: number | null, type: AlertType) => value === null ? '—' : formatNumber.format(value) + ' ' + units(type)

export function Alerts() {
  const [params, setParams] = useSearchParams()
  const [revision, setRevision] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<{ key: string; result: AlertPage } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [formError, setFormError] = useState('')
  const [formVersion, setFormVersion] = useState(0)
  const key = params.toString()
  const table = data?.key === key ? data.result : null
  const pageCount = table ? Math.max(1, Math.ceil(table.total / table.pageSize)) : 1
  const period = params.get('period')

  useEffect(() => subscribeTelemetry(snapshot => setRevision(snapshot?.alertsRevision ?? '')), [])
  useEffect(() => {
    const controller = new AbortController()
    void systemRequest<AlertPage>('/alerts?' + key, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setData({ key, result }); setError('') }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [key, revision, refresh])

  const goTo = (page: number) => {
    const next = new URLSearchParams(params)
    next.set('page', String(page))
    setParams(next)
  }

  async function markRead(id: number) {
    setBusy(id)
    try {
      await systemRequest(`/alerts/${id}/read`, { method: 'PATCH' })
      setRefresh(value => value + 1)
    } catch (failure) {
      setError((failure as Error).message)
    } finally { setBusy(null) }
  }

  return <div className="system-module">
    <header className="sensor-page-heading"><div><h1>Alertas del sistema</h1><p>Consulta condiciones ambientales y eventos de comunicación por sensor.</p></div></header>
    <form className="panel history-filters" key={key + formVersion} onSubmit={event => {
      event.preventDefault()
      const next = new URLSearchParams()
      for (const [name, value] of new FormData(event.currentTarget)) if (typeof value === 'string' && value) next.set(name, value)
      const from = next.get('from')
      const to = next.get('to')
      if ((from || to) && (!from || !to || from > to)) { setFormError('Indica ambas fechas en orden.'); return }
      if (from && to) next.set('period', 'custom')
      else if (period && period !== 'custom') next.set('period', period)
      setError(''); setFormError(''); setParams(next)
    }}>
      <div className="panel-heading"><span className="tile-icon purple"><Bell size={19} /></span><div><h2>Filtros de alertas</h2><p>{period && period in historyPeriods ? historyPeriods[period as keyof typeof historyPeriods] : 'Fechas en hora de Santiago de Chile'}</p></div></div>
      <div className="history-fields">
        <label>Fecha inicial<input name="from" type="date" defaultValue={params.get('from') ?? ''} /></label>
        <label>Fecha final<input name="to" type="date" defaultValue={params.get('to') ?? ''} /></label>
        <label>Tipo<select name="type" defaultValue={params.get('type') ?? ''}><option value="">Todos los tipos</option>
          {Object.entries(alertLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Severidad<select name="severity" defaultValue={params.get('severity') ?? ''}><option value="">Todas</option>
          {Object.entries(severityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Sensor<select name="sensor" defaultValue={params.get('sensor') ?? ''}><option value="">Todos los sensores</option>
          {Object.entries(sensorIdentifiers).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Resolución<select name="status" defaultValue={params.get('status') ?? ''}><option value="">Todos los estados</option><option value="active">Activas</option><option value="resolved">Resueltas</option></select></label>
        <label>Lectura<select name="read" defaultValue={params.get('read') ?? ''}><option value="">Todas</option><option value="unread">No leídas</option></select></label>
      </div>
      {formError && <p className="irrigation-error" role="alert">{formError}</p>}
      <div className="history-actions"><button className="irrigation-button primary">Aplicar filtros</button>
        <button type="button" className="irrigation-button" onClick={() => { setFormVersion(value => value + 1); setFormError(''); setError(''); setParams({}) }}>Restablecer</button></div>
    </form>
    <section className="panel history-table-card">
      <div className="history-section-heading"><div><h2>Historial de alertas</h2>
        <p>{table ? `${table.total} ${table.total === 1 ? 'evento' : 'eventos'} con los filtros aplicados` : 'Eventos guardados en SQLite'}</p></div></div>
      {error && <p className="irrigation-error" role="alert">{error}</p>}
      {!table && !error && <p className="history-empty">Cargando alertas…</p>}
      {table?.total === 0 && <p className="history-empty">Sin alertas para los filtros seleccionados.</p>}
      {table && table.total > 0 && <>
        <div className="history-table-scroll" tabIndex={0} role="region" aria-label="Tabla de alertas">
          <table><thead><tr><th>Tipo y fecha</th><th>Sensor</th><th>Valor</th><th>Límite al detectar</th><th>Severidad</th><th>Resolución</th><th>Lectura</th></tr></thead>
            <tbody>{table.rows.map(event => {
              const Icon = isConnectionAlert(event.type) ? Usb : CircleAlert
              return <tr key={event.id}>
                <td className="alert-type"><strong><Icon size={15} />{alertLabels[event.type]}</strong>
                  <span>{formatReadingTime(event.createdAt)}</span>{event.detail && <small title={event.detail}>{event.detail}</small>}</td>
                <td>{sensorIdentifiers[event.sensor]}<small>{originLabels[event.sensor]}</small></td>
                <td>{displayValue(event.value, event.type)}</td><td>{displayValue(event.threshold, event.type)}</td>
                <td><span className={`status-pill ${event.severity === 'critical' ? 'alert-critical' : 'stale'}`}>{severityLabels[event.severity]}</span></td>
                <td>{event.resolvedAt === null ? <span className="status-pill stale">Activa</span> :
                  <><span className="status-pill connected">Resuelta</span><small>{formatReadingTime(event.resolvedAt)}</small></>}</td>
                <td>{event.readAt === null ? <button className="irrigation-button" disabled={busy !== null} onClick={() => void markRead(event.id)}><Check size={14} />Marcar como leída</button> : 'Leída'}</td>
              </tr>
            })}</tbody></table>
        </div>
        <div className="history-pager"><span>Página {table.page} de {pageCount}</span>
          {table.rows.length === 0 && <button className="irrigation-button" onClick={() => goTo(pageCount)}>Ir a la última página</button>}
          <div><button className="icon-button" aria-label="Página anterior" disabled={table.page <= 1} onClick={() => goTo(table.page - 1)}><ChevronLeft size={17} /></button>
            <button className="icon-button" aria-label="Página siguiente" disabled={table.page >= pageCount} onClick={() => goTo(table.page + 1)}><ChevronRight size={17} /></button></div></div>
      </>}
    </section>
  </div>
}
