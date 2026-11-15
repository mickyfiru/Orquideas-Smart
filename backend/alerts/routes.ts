import { Router } from 'express'
import type { ErrorRequestHandler } from 'express'
import { alertLabels, isConnectionAlert } from '../../shared/alerts.ts'
import type { AlertType, NotificationItem } from '../../shared/alerts.ts'
import type { openDatabase } from '../database.ts'
import { HistoryQueryError, parseHistoryQuery } from '../history/query.ts'

export function createAlertRouter(db: ReturnType<typeof openDatabase>, changed: () => void, clock: () => number) {
  const router = Router()
  router.get('/', (req, res) => {
    const { period, from, to, sensor, type, severity, status, read, page, pageSize } = req.query
    const query = parseHistoryQuery({ period, from, to, sensor, page, pageSize }, clock(), db.sensors())
    if (type !== undefined && (typeof type !== 'string' || !Object.hasOwn(alertLabels, type))) throw new HistoryQueryError('Selecciona un tipo válido.')
    if (severity !== undefined && severity !== 'warning' && severity !== 'critical') throw new HistoryQueryError('Selecciona una severidad válida.')
    if (status !== undefined && status !== 'active' && status !== 'resolved') throw new HistoryQueryError('Selecciona un estado válido.')
    if (read !== undefined && read !== 'unread') throw new HistoryQueryError('Selecciona un estado de lectura válido.')
    const useDates = period !== undefined || from !== undefined || to !== undefined
    res.json(db.alerts.page({
      from: useDates ? query.filters.from : undefined, until: useDates ? query.filters.until : undefined,
      sensor: query.filters.sensor, type: type as AlertType | undefined, severity, status, unread: read === 'unread',
      page: query.page, pageSize: query.pageSize,
    }))
  })
  router.patch('/:id/read', (req, res) => {
    const id = Number(req.params.id)
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) return res.status(400).json({ error: 'Identificador inválido.' })
    if (!db.alerts.markRead(id, clock())) return res.status(404).json({ error: 'No se encontró la alerta.' })
    changed()
    return res.status(204).end()
  })
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HistoryQueryError) { res.status(400).json({ error: error.message }); return }
    console.error('Error de alertas', error)
    res.status(500).json({ error: 'No se pudo consultar o actualizar las alertas.' })
  }
  router.use(onError)
  return router
}

export function notificationInbox(db: ReturnType<typeof openDatabase>) {
  const preferences = db.preferences()
  const irrigation = db.irrigation.inbox()
  const alerts = db.alerts.counts()
  const recent: NotificationItem[] = [
    ...irrigation.rows.map((item): NotificationItem => ({
      kind: 'irrigation', id: item.id, title: item.name, time: item.notifiedAt, readAt: item.readAt,
      scheduledAt: item.scheduledAt,
      detail: item.completedAt === null ? 'Recordatorio de riego' : 'Riego realizado',
    })),
    ...db.alerts.recent().map((item): NotificationItem => ({
      kind: isConnectionAlert(item.type) ? 'connection' : 'environment', id: item.id, title: alertLabels[item.type],
      time: item.createdAt, readAt: item.readAt,
      detail: (item.sensor === 'arduino' ? 'Arduino · DHT11' : 'Simulación') + (item.resolvedAt === null ? ' · Activa' : ' · Resuelta'),
    })),
  ].sort((a, b) => b.time - a.time || b.id - a.id)
  return {
    recent, preferences,
    items: recent.filter(item => item.kind === 'irrigation' ? preferences.irrigation : preferences.environmental).slice(0, 30),
    unread: (preferences.irrigation ? irrigation.unread : 0) + (preferences.environmental ? alerts.unread : 0),
  }
}
