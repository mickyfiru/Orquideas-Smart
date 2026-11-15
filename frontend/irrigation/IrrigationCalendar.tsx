import { useEffect, useMemo, useState } from 'react'
import { Temporal } from '@js-temporal/polyfill'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Droplets, Pencil, Plus, Trash2 } from 'lucide-react'
import { localDate, recurrenceLabels, weekdays } from '../../shared/irrigation.ts'
import type { IrrigationOccurrence, Schedule, ScheduleInput } from '../../shared/irrigation.ts'
import { subscribeTelemetry } from '../telemetrySocket.ts'
import { irrigationDate, irrigationRequest, irrigationTime } from './api.ts'
import { IrrigationDialog, ScheduleDialog } from './ScheduleDialog.tsx'
import './irrigation.css'

type DialogState = { type: 'form'; schedule?: Schedule } | { type: 'delete'; schedule: Schedule }
type CalendarData = {
  month: string
  monthEntries: IrrigationOccurrence[]
  schedules: Schedule[]
  upcoming: IrrigationOccurrence[]
  completed: IrrigationOccurrence[]
}

const occurrenceKey = (item: IrrigationOccurrence) => `${item.scheduleId}-${item.scheduledAt}`

export function IrrigationCalendar() {
  const [selected, select] = useState(() => localDate(Date.now()))
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [data, setData] = useState<CalendarData | null>(null)
  const [revision, setRevision] = useState('')
  const [reload, setReload] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const month = selected.toString().slice(0, 7)
  const first = selected.with({ day: 1 })
  const today = localDate(Date.now())
  const weeks = Math.ceil((first.dayOfWeek - 1 + first.daysInMonth) / 7)
  const days = Array.from({ length: weeks * 7 }, (_, index) => first.add({ days: index - first.dayOfWeek + 1 }))

  useEffect(() => subscribeTelemetry(snapshot => setRevision(snapshot?.irrigationRevision ?? '')), [])
  useEffect(() => {
    const controller = new AbortController()
    const options = { signal: controller.signal }
    void Promise.all([
      irrigationRequest<IrrigationOccurrence[]>(`/calendar?month=${month}`, options),
      irrigationRequest<Schedule[]>('/schedules', options),
      irrigationRequest<IrrigationOccurrence[]>('/upcoming', options),
      irrigationRequest<IrrigationOccurrence[]>('/completed', options),
    ]).then(([monthEntries, schedules, upcoming, completed]) => {
      if (controller.signal.aborted) return
      setData({ month, monthEntries, schedules, upcoming, completed })
      setError('')
    }).catch(() => {
      if (!controller.signal.aborted) setError('No se pudieron cargar los datos de riego.')
    })
    return () => controller.abort()
  }, [month, revision, reload])

  const grouped = useMemo(() => {
    const result = new Map<string, IrrigationOccurrence[]>()
    if (!data || data.month !== month) return result
    for (const item of data.monthEntries) {
      const key = localDate(item.scheduledAt).toString()
      const entries = result.get(key) ?? []
      entries.push(item)
      result.set(key, entries)
    }
    return result
  }, [data, month])

  function refresh(success: string) {
    setReload(value => value + 1)
    setMessage(success)
    setActionError('')
  }

  async function save(input: ScheduleInput) {
    const id = dialog?.schedule?.id
    await irrigationRequest<Schedule>(id ? `/schedules/${id}` : '/schedules', {
      method: id ? 'PUT' : 'POST', body: JSON.stringify(input),
    })
    const start = localDate(Date.now())
    select(input.date < start.toString() && input.recurrence !== 'once' ? start : Temporal.PlainDate.from(input.date))
    setDialog(null)
    refresh(id ? 'Programación actualizada.' : 'Riego programado.')
  }

  async function removeSchedule(schedule: Schedule) {
    setBusy(true)
    try {
      await irrigationRequest(`/schedules/${schedule.id}`, { method: 'DELETE' })
      setDialog(null)
      refresh('Programación eliminada. Los riegos realizados se conservan.')
    } catch (failure) {
      setActionError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function complete(item: IrrigationOccurrence) {
    setBusy(true)
    try {
      await irrigationRequest('/completed', { method: 'POST', body: JSON.stringify({
        scheduleId: item.scheduleId, scheduledAt: item.scheduledAt,
      }) })
      refresh('Riego registrado como realizado.')
    } catch (failure) {
      setActionError((failure as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const selectedEntries = grouped.get(selected.toString()) ?? []
  const monthLoaded = data?.month === month
  const openDialog = (value: DialogState) => { setActionError(''); setMessage(''); setDialog(value) }
  const entries = (list: IrrigationOccurrence[], dateOnly = false) => (
    <ul className="watering-list">
      {list.map(item => (
        <li key={occurrenceKey(item)}>
          <div><strong>{item.name}</strong><p>{(dateOnly ? irrigationTime : irrigationDate).format(item.scheduledAt)}</p></div>
          {item.completedAt !== null ? <span className="status-pill connected"><Check size={12} />Realizado</span> :
            <button className="icon-button complete-button" aria-label={`Marcar como realizado: ${item.name}, ${irrigationDate.format(item.scheduledAt)}`}
              title="Marcar como realizado" disabled={busy} onClick={() => void complete(item)}><Check size={17} /></button>}
        </li>
      ))}
    </ul>
  )

  return (
    <div className="irrigation">
      <div className="irrigation-page-header">
        <div><h1>Calendario de riego</h1><p>Programa tus riegos manuales y registra cuándo los realizas.</p></div>
        <button className="irrigation-button primary" onClick={() => openDialog({ type: 'form' })}><Plus size={18} />Nuevo riego</button>
      </div>
      {message && <p className="irrigation-success" role="status"><Check size={16} />{message}</p>}
      {error && <div className="irrigation-error" role="alert">{error} <button className="text-link" onClick={() => setReload(value => value + 1)}>Reintentar</button></div>}
      {actionError && !dialog && <p className="irrigation-error" role="alert">{actionError}</p>}

      <div className="irrigation-main">
        <section className="panel irrigation-card">
          <div className="irrigation-heading month-heading">
            <div><h2>{first.toLocaleString('es-CL', { month: 'long', year: 'numeric' })}</h2><p>Hora de Santiago de Chile</p></div>
            <div className="month-controls">
              <button className="irrigation-button" onClick={() => select(today)}>Hoy</button>
              <button className="icon-button" aria-label="Mes anterior" disabled={month === '1900-01'}
                onClick={() => select(first.subtract({ months: 1 }))}><ChevronLeft size={19} /></button>
              <button className="icon-button" aria-label="Mes siguiente" disabled={month === '9999-12'}
                onClick={() => select(first.add({ months: 1 }))}><ChevronRight size={19} /></button>
            </div>
          </div>
          <div className="month-grid" aria-label="Días del mes">
            {weekdays.map(day => <span className="weekday" key={day}>{day}</span>)}
            {days.map(date => {
              const key = date.toString()
              if (first.month !== date.month) return <span className="outside-month" key={key} />
              const list = grouped.get(key) ?? []
              const pending = list.filter(item => item.completedAt === null).length
              const done = list.length - pending
              const label = date.toLocaleString('es-CL', { dateStyle: 'long' })
              return <button key={key} type="button" className="month-day" aria-pressed={date.equals(selected)}
                aria-current={date.equals(today) ? 'date' : undefined}
                aria-label={`${label}${pending ? `, ${pending} programados` : ''}${done ? `, ${done} realizados` : ''}`}
                onClick={() => { select(date); setMessage('') }}>
                <span className="day-number">{date.day}</span>
                {pending > 0 && <span className="day-marker pending"><i />{pending}<span> por regar</span></span>}
                {done > 0 && <span className="day-marker done"><i />{done}<span> realizados</span></span>}
              </button>
            })}
          </div>
          <div className="calendar-legend" aria-hidden="true">
            <span className="day-marker pending"><i />Por regar</span>
            <span className="day-marker done"><i />Realizado</span>
          </div>
        </section>

        <div className="irrigation-aside">
          <section className="panel irrigation-card agenda">
            <div className="panel-heading"><span className="tile-icon green"><CalendarDays size={19} /></span>
              <div><h2>{selected.toLocaleString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</h2><p>Riegos del día</p></div></div>
            {monthLoaded ? selectedEntries.length ? entries(selectedEntries, true) :
              <p className="irrigation-empty">Sin riegos para este día.</p> : !error && <p className="irrigation-empty">Cargando agenda…</p>}
          </section>
          <section className="panel irrigation-card">
            <div className="panel-heading"><span className="tile-icon purple"><Droplets size={19} /></span>
              <div><h2>Próximos riegos</h2><p>Hasta diez riegos programados</p></div></div>
            {data ? data.upcoming.length ? entries(data.upcoming) : <p className="irrigation-empty">Sin riegos programados.</p> :
              !error && <p className="irrigation-empty">Cargando programaciones…</p>}
          </section>
        </div>
      </div>

      <div className="irrigation-bottom">
        <section className="panel irrigation-card">
          <div className="panel-heading"><div><h2>Programaciones</h2><p>Edita, pausa o elimina un riego.</p></div></div>
          {data?.schedules.length ? <ul className="watering-list">{data.schedules.map(schedule => (
            <li key={schedule.id}>
              <div><strong>{schedule.name}</strong>
                <p>{recurrenceLabels[schedule.recurrence]} · {schedule.date} · {schedule.time}</p>
                <p>{schedule.active ? 'Activa' : 'Pausada'}{schedule.weekdays.length > 0 && ` · ${schedule.weekdays.map(day => weekdays[day - 1]).join(', ')}`}</p>
              </div>
              <div className="row-actions">
                <button className="icon-button" aria-label={`Editar ${schedule.name}`} onClick={() => openDialog({ type: 'form', schedule })}><Pencil size={16} /></button>
                <button className="icon-button danger-icon" aria-label={`Eliminar ${schedule.name}`} onClick={() => openDialog({ type: 'delete', schedule })}><Trash2 size={16} /></button>
              </div>
            </li>
          ))}</ul> : data && <p className="irrigation-empty">Todavía no hay programaciones.</p>}
        </section>
        <section className="panel irrigation-card">
          <div className="panel-heading"><div><h2>Riegos realizados</h2><p>Registro de riegos manuales completados.</p></div></div>
          {data?.completed.length ? <ul className="watering-list">{data.completed.map(item => (
            <li key={occurrenceKey(item)}><div><strong>{item.name}</strong>
              <p>Programado · {irrigationDate.format(item.scheduledAt)}</p>
              <p>Realizado · {irrigationDate.format(item.completedAt!)}</p></div>
              <span className="status-pill connected"><Check size={12} />Realizado</span>
            </li>
          ))}</ul> : data && <p className="irrigation-empty">Todavía no hay riegos realizados.</p>}
        </section>
      </div>

      {dialog?.type === 'form' && <ScheduleDialog schedule={dialog.schedule} date={selected.toString()}
        close={() => setDialog(null)} save={save} />}
      {dialog?.type === 'delete' && <IrrigationDialog title="Eliminar programación" close={() => setDialog(null)} busy={busy}>
        <p className="delete-details">Se cancelarán los próximos riegos de <strong>{dialog.schedule.name}</strong>. Los riegos realizados se conservarán en el registro.</p>
        {actionError && <p className="irrigation-error" role="alert">{actionError}</p>}
        <div className="dialog-actions">
          <button className="irrigation-button" disabled={busy} onClick={() => setDialog(null)}>Cancelar</button>
          <button className="irrigation-button danger" disabled={busy} onClick={() => void removeSchedule(dialog.schedule)}>Eliminar programación</button>
        </div>
      </IrrigationDialog>}
    </div>
  )
}
