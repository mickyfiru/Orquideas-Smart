import { useState } from 'react'
import { Filter } from 'lucide-react'
import { historyPeriods, originLabels, sensorIdentifiers } from '../../shared/history.ts'
import { localDate } from '../../shared/irrigation.ts'
import type { RegisteredSensor } from '../../shared/telemetry.ts'

export function HistoryFilters({ applied, sensors, apply }: {
  applied: URLSearchParams; sensors: RegisteredSensor[]; apply: (filters: URLSearchParams) => void
}) {
  const [period, setPeriod] = useState(applied.get('period') ?? 'day')
  const [sensorId, setSensorId] = useState(applied.get('sensor') ?? '')
  const [error, setError] = useState('')
  const custom = period === 'custom'
  const today = localDate(Date.now()).toString()

  return <form className="panel history-filters" onSubmit={event => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const from = String(fields.get('from') ?? '')
    const to = String(fields.get('to') ?? '')
    if (custom && (!from || !to || from > to)) {
      setError('Indica una fecha inicial anterior o igual a la final.')
      return
    }
    const next = new URLSearchParams()
    for (const [key, value] of fields) if (typeof value === 'string' && value) next.set(key, value)
    setError('')
    apply(next)
  }}>
    <div className="panel-heading"><span className="tile-icon green"><Filter size={19} /></span>
      <div><h2>Filtros del historial</h2><p>El período se interpreta en hora de Santiago de Chile.</p></div></div>
    <div className="history-fields">
      <label>Período<select name="period" value={period} onChange={event => { setPeriod(event.target.value); setError('') }}>
        {Object.entries(historyPeriods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Sensor<select name="sensor" value={sensorId} onChange={event => setSensorId(event.target.value)}>
        <option value="">Todos los sensores</option>
        {sensors.map(sensor => <option key={sensor.id} value={sensor.id}>{sensorIdentifiers[sensor.id]} · {sensor.name}</option>)}
      </select></label>
      <label>Origen<select name="origin" defaultValue={applied.get('origin') ?? ''}>
        <option value="">Todos los orígenes</option>
        {Object.entries(originLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Condición ambiental<select name="condition" defaultValue={applied.get('condition') ?? ''}>
        <option value="">Todas las condiciones</option><option value="normal">En rango</option><option value="out">Fuera de rango</option>
      </select></label>
      {custom && <>
        <label>Fecha inicial<input name="from" type="date" required defaultValue={applied.get('from') || today} /></label>
        <label>Fecha final<input name="to" type="date" required defaultValue={applied.get('to') || today} /></label>
      </>}
    </div>
    {error && <p className="irrigation-error" role="alert">{error}</p>}
    <div className="history-actions">
      <button className="irrigation-button primary">Aplicar filtros</button>
      <button className="irrigation-button" type="button" onClick={() => {
        setPeriod('day'); setError(''); apply(new URLSearchParams())
      }}>Restablecer</button>
    </div>
  </form>
}
