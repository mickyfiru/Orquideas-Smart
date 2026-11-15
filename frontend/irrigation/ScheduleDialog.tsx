import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { recurrenceLabels, validateSchedule, weekdays } from '../../shared/irrigation.ts'
import type { Schedule, ScheduleInput } from '../../shared/irrigation.ts'

export function IrrigationDialog({ title, close, busy, children }: { title: string; close: () => void; busy: boolean; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => dialog.current?.showModal(), [])
  return <dialog ref={dialog} aria-labelledby="irrigation-modal-title" className="panel irrigation-dialog"
    onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    <div className="irrigation-heading"><h2 id="irrigation-modal-title">{title}</h2>
      <button className="icon-button" type="button" aria-label="Cerrar diálogo" disabled={busy} onClick={close}><X size={18} /></button>
    </div>
    {children}
  </dialog>
}

export function ScheduleDialog({ schedule, date, close, save }: {
  schedule?: Schedule; date: string; close: () => void; save: (input: ScheduleInput) => Promise<void>
}) {
  const [input, setInput] = useState<ScheduleInput>(() => schedule ?? {
    name: '', date, time: '08:00', recurrence: 'once', weekdays: [], active: true,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const patch = (change: Partial<ScheduleInput>) => setInput(previous => ({ ...previous, ...change }))

  return <IrrigationDialog title={schedule ? 'Editar programación' : 'Programar riego'} close={close} busy={busy}>
    <form className="irrigation-form" onSubmit={async event => {
      event.preventDefault()
      const result = validateSchedule(input, Date.now())
      if ('error' in result) { setError(result.error); return }
      setBusy(true)
      setError('')
      try {
        await save(result.input)
      } catch (failure) {
        setError((failure as Error).message)
        setBusy(false)
      }
    }}>
      <label>Nombre o descripción<input required maxLength={100} value={input.name}
        onChange={event => patch({ name: event.target.value })} /></label>
      <div className="form-columns">
        <label>Fecha<input type="date" required value={input.date} onChange={event => patch({ date: event.target.value })} /></label>
        <label>Hora<input type="time" required value={input.time} onChange={event => patch({ time: event.target.value })} /></label>
      </div>
      <p className="irrigation-muted">Hora local de Santiago de Chile.</p>
      <div className="form-columns">
        <label>Recurrencia<select value={input.recurrence} onChange={event => patch({ recurrence: event.target.value as ScheduleInput['recurrence'] })}>
          {Object.entries(recurrenceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Estado<select value={input.active ? 'active' : 'paused'} onChange={event => patch({ active: event.target.value === 'active' })}>
          <option value="active">Activo</option><option value="paused">Pausado</option>
        </select></label>
      </div>
      {input.recurrence === 'weekly' && <p className="irrigation-muted">Se repite el mismo día de la semana de la fecha inicial.</p>}
      {input.recurrence === 'custom' && <fieldset><legend>Días de la semana</legend>
        <div className="weekday-controls">{weekdays.map((day, index) => <label key={day}>
          <input type="checkbox" checked={input.weekdays.includes(index + 1)} onChange={event => patch({
            weekdays: event.target.checked ? [...input.weekdays, index + 1] : input.weekdays.filter(value => value !== index + 1),
          })} />{day}
        </label>)}</div>
      </fieldset>}
      {error && <p className="irrigation-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="irrigation-button" disabled={busy} onClick={close}>Cancelar</button>
        <button type="submit" className="irrigation-button primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar programación'}</button>
      </div>
    </form>
  </IrrigationDialog>
}
