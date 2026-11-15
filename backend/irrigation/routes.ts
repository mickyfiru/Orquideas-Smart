import { json, Router } from 'express'
import type { ErrorRequestHandler } from 'express'
import { Temporal } from '@js-temporal/polyfill'
import { scheduledTime, validateSchedule } from '../../shared/irrigation.ts'
import type { createIrrigationStore } from './store.ts'

const validId = (id: number) => Number.isSafeInteger(id) && id > 0

export function createIrrigationRouter(store: ReturnType<typeof createIrrigationStore>, clock: () => number, changed: () => void) {
  const router = Router()
  router.use(json({ limit: '8kb' }))

  router.get('/schedules', (_req, res) => res.json(store.schedules()))
  router.get('/upcoming', (_req, res) => res.json(store.upcoming(clock())))
  router.get('/completed', (_req, res) => res.json(store.completed()))
  router.get('/notifications', (_req, res) => res.json(store.notifications()))
  router.get('/calendar', (req, res) => {
    const { month } = req.query
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: 'Selecciona un mes válido.' })
    }
    const start = Temporal.PlainDate.from(month + '-01')
    const end = start.add({ months: 1 })
    return res.json(store.calendar(scheduledTime(start, '00:00'), scheduledTime(end, '00:00')))
  })

  router.post('/schedules', (req, res) => {
    const now = clock()
    const validation = validateSchedule(req.body, now)
    if ('error' in validation) return res.status(400).json(validation)
    const schedule = store.create(validation.input, now)
    changed()
    return res.status(201).json(schedule)
  })

  router.put('/schedules/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!validId(id)) return res.status(400).json({ error: 'Identificador inválido.' })
    const now = clock()
    const validation = validateSchedule(req.body, now)
    if ('error' in validation) return res.status(400).json(validation)
    const schedule = store.update(id, validation.input, now)
    if (!schedule) return res.status(404).json({ error: 'No se encontró la programación.' })
    changed()
    return res.json(schedule)
  })

  router.delete('/schedules/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!validId(id)) return res.status(400).json({ error: 'Identificador inválido.' })
    if (!store.remove(id, clock())) return res.status(404).json({ error: 'No se encontró la programación.' })
    changed()
    return res.status(204).end()
  })

  router.post('/completed', (req, res) => {
    const { scheduleId, scheduledAt } = req.body ?? {}
    if (!validId(scheduleId) || !Number.isSafeInteger(scheduledAt) || Math.abs(scheduledAt) > 8.64e15) {
      return res.status(400).json({ error: 'Selecciona una ocurrencia válida.' })
    }
    const result = store.record(scheduleId, scheduledAt, clock())
    changed()
    if (!result) return res.status(409).json({ error: 'El riego ya no está programado para esa fecha y hora.' })
    return res.json(result)
  })

  router.patch('/notifications/:id/read', (req, res) => {
    const id = Number(req.params.id)
    if (!validId(id)) return res.status(400).json({ error: 'Identificador inválido.' })
    if (!store.markRead(id, clock())) return res.status(404).json({ error: 'No se encontró el recordatorio.' })
    changed()
    return res.status(204).end()
  })

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la solicitud es inválido.' })
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud excede el tamaño permitido.' })
    console.error('Error de API de riego', error)
    return res.status(500).json({ error: 'Ocurrió un error al acceder a los datos de riego.' })
  }
  router.use(handleError)
  return router
}
