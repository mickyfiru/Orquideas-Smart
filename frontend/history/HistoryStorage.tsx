import { useState } from 'react'
import { Database } from 'lucide-react'
import { storageIntervals } from '../../shared/history.ts'
import { useTelemetry } from '../dashboard/useTelemetry.ts'
import { historyRequest } from './api.ts'

export function HistoryStorage() {
  const { snapshot, transport } = useTelemetry(null)
  const current = snapshot?.settings.storageMinutes
  const [draft, setDraft] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const enabled = transport === 'online' && current !== undefined && !saving
  return <details className="panel history-storage">
    <summary><Database size={18} /><span>Frecuencia de almacenamiento</span><small>{current !== undefined ? `Cada ${current} min` : 'Consultando…'}</small></summary>
    <form className="history-storage-form" onSubmit={async event => {
      event.preventDefault()
      const value = draft ?? current
      if (value === undefined) return
      setSaving(true); setError(''); setMessage('')
      try {
        await historyRequest('/storage', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storageMinutes: value }),
        })
        setDraft(null)
        setMessage('Frecuencia guardada.')
      } catch (failure) {
        setError((failure as Error).message)
      } finally {
        setSaving(false)
      }
    }}>
      <p>Este intervalo controla el registro histórico. El monitoreo sigue recibiendo las lecturas en tiempo real.</p>
      <div className="history-actions">
        <label>Guardar una lectura<select disabled={!enabled} value={draft ?? current ?? ''}
          onChange={event => { setDraft(Number(event.target.value)); setMessage(''); setError('') }}>
          {current === undefined && <option value="">Consultando…</option>}
          {current !== undefined && !storageIntervals.some(interval => interval === current) && <option value={current}>Cada {current} min</option>}
          {storageIntervals.map(interval => <option value={interval} key={interval}>
            {interval === 60 ? 'Cada 1 hora' : `Cada ${interval} ${interval === 1 ? 'minuto' : 'minutos'}`}
          </option>)}
        </select></label>
        <button className="irrigation-button primary" disabled={!enabled || draft === null || draft === current}>Guardar frecuencia</button>
      </div>
      {message && <p className="history-saved" role="status">{message}</p>}
      {error && <p className="irrigation-error" role="alert">{error}</p>}
    </form>
  </details>
}
