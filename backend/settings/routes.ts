import { readFileSync } from 'node:fs'
import { json, Router } from 'express'
import type { ErrorRequestHandler } from 'express'
import { validateEnvironment } from '../../shared/settings.ts'
import { irrigationZone } from '../../shared/irrigation.ts'
import type { DashboardSnapshot } from '../../shared/telemetry.ts'
import type { openDatabase } from '../database.ts'

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }

export function createSettingsRouter(db: ReturnType<typeof openDatabase>, snapshot: () => DashboardSnapshot, changed: (limits: boolean) => void) {
  const router = Router()
  router.use(json({ limit: '4kb' }))
  router.get('/', (_req, res) => {
    const state = snapshot()
    res.json({
      settings: state.settings, preferences: db.preferences(), mode: state.mode,
      version, timeZone: irrigationZone, services: { api: 'online', database: 'online' },
    })
  })
  router.put('/environment', (req, res) => {
    const error = validateEnvironment(req.body)
    if (error) return res.status(400).json({ error })
    db.setEnvironment(req.body)
    changed(true)
    return res.json(db.settings())
  })
  router.put('/notifications', (req, res) => {
    const { environmental, browser, irrigation } = req.body ?? {}
    if ([environmental, browser, irrigation].some(value => typeof value !== 'boolean')) {
      return res.status(400).json({ error: 'Selecciona una preferencia válida para cada tipo de aviso.' })
    }
    db.setPreferences({ environmental, browser, irrigation })
    changed(false)
    return res.json(db.preferences())
  })
  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') { res.status(400).json({ error: 'El cuerpo de la solicitud es inválido.' }); return }
    if (error.type === 'entity.too.large') { res.status(413).json({ error: 'La solicitud es demasiado grande.' }); return }
    console.error('Error de configuración', error)
    res.status(500).json({ error: 'No se pudo consultar o guardar la configuración.' })
  }
  router.use(handleError)
  return router
}
