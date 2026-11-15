import { Temporal } from '@js-temporal/polyfill'

export const irrigationZone = 'America/Santiago'
export const weekdays = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
export const recurrenceLabels = { once: 'Sin recurrencia', daily: 'Diaria', weekly: 'Semanal', custom: 'Personalizada' } as const

export interface ScheduleInput {
  name: string
  date: string
  time: string
  recurrence: keyof typeof recurrenceLabels
  weekdays: number[]
  active: boolean
}
export interface Schedule extends ScheduleInput {
  id: number
  createdAt: number
  updatedAt: number
}
export interface IrrigationOccurrence {
  scheduleId: number
  name: string
  scheduledAt: number
  completedAt: number | null
}
export interface IrrigationNotification extends IrrigationOccurrence {
  id: number
  notifiedAt: number
  readAt: number | null
}

export function localDate(at: number) {
  return Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(irrigationZone).toPlainDate()
}

export function scheduledTime(date: Temporal.PlainDate, time: string) {
  return date.toPlainDateTime(time).toZonedDateTime(irrigationZone, { disambiguation: 'compatible' }).epochMilliseconds
}

export function nextOccurrence(input: ScheduleInput, from: number): number | null {
  if (!input.active) return null
  const anchor = Temporal.PlainDate.from(input.date)
  const current = localDate(from)
  const start = Temporal.PlainDate.compare(anchor, current) > 0 ? anchor : current
  for (let offset = 0; offset < 8; offset++) {
    const date = start.add({ days: offset })
    const matches = input.recurrence === 'daily'
      || (input.recurrence === 'once' && date.equals(anchor))
      || (input.recurrence === 'weekly' && date.dayOfWeek === anchor.dayOfWeek)
      || (input.recurrence === 'custom' && input.weekdays.includes(date.dayOfWeek))
    if (matches) {
      const time = scheduledTime(date, input.time)
      if (time >= from) return time
    }
    if (input.recurrence === 'once') break
  }
  return null
}

export function validateSchedule(value: unknown, now: number): { input: ScheduleInput } | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'Completa los datos del riego.' }
  const { name, date, time, recurrence, weekdays: days, active } = value as Partial<ScheduleInput>
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) return { error: 'Escribe un nombre de 1 a 100 caracteres.' }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1900-01-01' || date > '9999-12-31') {
    return { error: 'Selecciona una fecha válida.' }
  }
  try {
    Temporal.PlainDate.from(date)
  } catch {
    return { error: 'Selecciona una fecha válida.' }
  }
  if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Selecciona una hora válida.' }
  if (typeof recurrence !== 'string' || !Object.hasOwn(recurrenceLabels, recurrence)) return { error: 'Selecciona una recurrencia válida.' }
  if (!Array.isArray(days) || days.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(days).size !== days.length) {
    return { error: 'Selecciona días de la semana válidos.' }
  }
  if (recurrence === 'custom' && !days.length) return { error: 'Selecciona al menos un día para la recurrencia personalizada.' }
  if (typeof active !== 'boolean') return { error: 'Selecciona el estado de la programación.' }
  const input = { name: name.trim(), date, time, recurrence, weekdays: recurrence === 'custom' ? [...days].sort() : [], active }
  if (active && recurrence === 'once' && nextOccurrence(input, Math.floor(now / 60_000) * 60_000) === null) {
    return { error: 'Selecciona una fecha y hora actual o futura para un riego único activo.' }
  }
  return { input }
}
