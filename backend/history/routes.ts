import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Temporal } from '@js-temporal/polyfill'
import { json, Router } from 'express'
import type { ErrorRequestHandler, Request } from 'express'
import { originLabels, sensorIdentifiers, storageIntervals } from '../../shared/history.ts'
import { irrigationZone } from '../../shared/irrigation.ts'
import type { openDatabase } from '../database.ts'
import { HistoryQueryError, parseHistoryQuery } from './query.ts'

export function createHistoryRouter(db: ReturnType<typeof openDatabase>, changed: () => void, clock = Date.now) {
  const router = Router()
  const query = (req: Request) => parseHistoryQuery(req.query, clock(), db.sensors())
  router.use(json({ limit: '4kb' }))
  router.get('/readings', (req, res) => res.json(db.archive.page(query(req))))
  router.get('/summary', (req, res) => {
    const { filters } = query(req)
    res.json({
      statistics: db.archive.statistics(filters),
      series: db.archive.series(filters),
      storageMinutes: db.settings().storageMinutes,
    })
  })
  router.get('/storage', (_req, res) => res.json({ storageMinutes: db.settings().storageMinutes }))
  router.put('/storage', (req, res) => {
    const value = req.body?.storageMinutes
    if (!storageIntervals.some(interval => interval === value)) {
      return res.status(400).json({ error: 'Selecciona una frecuencia de 1, 5, 15, 30 o 60 minutos.' })
    }
    db.setStorageMinutes(value)
    changed()
    return res.json({ storageMinutes: value })
  })
  router.get('/export.csv', async (req, res) => {
    const options = query(req)
    const rows = db.archive.exportRows(options)
    const first = rows.next()
    function* csv() {
      try {
        yield '\uFEFFFecha y hora (America/Santiago),Sensor,Origen,Temperatura (°C),Humedad relativa (%),Estado ambiental,Validez\r\n'
        for (let row = first; !row.done; row = rows.next()) {
          const value = row.value
          const date = Temporal.Instant.fromEpochMilliseconds(value.time).toZonedDateTimeISO(irrigationZone)
            .toString({ timeZoneName: 'never', smallestUnit: 'millisecond' })
          yield [date, sensorIdentifiers[value.sensorId], originLabels[value.origin], value.temperature, value.humidity,
            value.condition === 'normal' ? 'En rango' : 'Fuera de rango', 'Válida'].join(',') + '\r\n'
        }
      } finally {
        rows.return()
      }
    }
    res.attachment('historial-ambiental.csv')
    res.type('text/csv; charset=utf-8')
    await pipeline(Readable.from(csv()), res)
  })

  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent || res.destroyed) {
      if (!res.destroyed) next(error)
      return
    }
    if (error instanceof HistoryQueryError) { res.status(400).json({ error: error.message }); return }
    if (error.type === 'entity.parse.failed') { res.status(400).json({ error: 'El cuerpo de la solicitud es inválido.' }); return }
    if (error.type === 'entity.too.large') { res.status(413).json({ error: 'La solicitud es demasiado grande.' }); return }
    console.error('Error en servicio de historial', error)
    res.status(500).json({ error: 'No se pudo consultar o guardar la información histórica.' })
  }
  router.use(handleError)
  return router
}
