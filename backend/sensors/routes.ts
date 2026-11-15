import { json, Router } from 'express'
import type { ErrorRequestHandler } from 'express'
import type { AcquisitionSource } from '../source.ts'
import type { openDatabase } from '../database.ts'
import { SerialConnectionError } from './serial.ts'
import type { createSerialAcquisition } from './serial.ts'
import type { Mode } from '../../shared/telemetry.ts'

export function createSensorRouter(
  db: ReturnType<typeof openDatabase>, serial: ReturnType<typeof createSerialAcquisition>,
  source: () => AcquisitionSource, changeMode: (mode: Mode) => void, changed: () => void,
) {
  const router = Router()
  router.use(json({ limit: '4kb' }))
  router.get('/', (_req, res) => res.json(db.sensors().map(sensor => ({
    ...sensor, latest: db.latestReceived(sensor.id) ?? db.latest(sensor.id),
  }))))
  router.get('/ports', async (_req, res) => res.json(await serial.list()))
  router.put('/mode', (req, res) => {
    const mode = req.body?.mode
    if (mode !== 'arduino' && mode !== 'simulation') return res.status(400).json({ error: 'Selecciona un modo válido.' })
    changeMode(mode)
    return res.status(204).end()
  })
  router.post('/connect', async (req, res) => {
    const path = req.body?.path
    if (typeof path !== 'string' || !path.trim() || path.length > 256) {
      return res.status(400).json({ error: 'Selecciona un puerto serie válido.' })
    }
    if (source() !== serial.source) return res.status(409).json({ error: 'Selecciona el modo Arduino antes de conectar.' })
    await serial.connect(path)
    db.setPort(path)
    return res.status(204).end()
  })
  router.post('/disconnect', async (_req, res) => {
    await serial.disconnect()
    return res.status(204).end()
  })
  router.put('/humidity-tolerance', (req, res) => {
    const value = req.body?.value
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      return res.status(400).json({ error: 'Indica una tolerancia de 0 a 100 puntos porcentuales.' })
    }
    db.setTolerance(value)
    changed()
    return res.status(204).end()
  })
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof SerialConnectionError) return res.status(409).json({ error: error.message })
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la solicitud es inválido.' })
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'La solicitud es demasiado grande.' })
    console.error('Error en servicio de sensores', error)
    return res.status(500).json({ error: 'No se pudo completar la operación de sensores.' })
  }
  router.use(onError)
  return router
}
