import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Temporal } from '@js-temporal/polyfill'
import { createApplication } from './app.ts'
import { openDatabase } from './database.ts'
import { offlineArduino } from './source.ts'
import type { AcquisitionSource } from './source.ts'
import type { HistoryPage, HistorySummary } from '../shared/history.ts'
import { irrigationZone } from '../shared/irrigation.ts'
import type { DashboardSnapshot, Measurement, Mode } from '../shared/telemetry.ts'

const at = (local: string) => Temporal.PlainDateTime.from(local).toZonedDateTime(irrigationZone).epochMilliseconds
const period = 'period=custom&from=2026-09-06&to=2026-09-06'
const records = [
  { mode: 'simulation', time: at('2026-09-05T23:59'), humidity: 78, temperature: 22 },
  { mode: 'simulation', time: at('2026-09-06T01:00'), humidity: 75, temperature: 18 },
  { mode: 'arduino', time: at('2026-09-06T15:30'), humidity: 80, temperature: 24 },
  { mode: 'simulation', time: at('2026-09-06T23:59'), humidity: 91, temperature: 27 },
  { mode: 'arduino', time: at('2026-09-07T00:00'), humidity: 79, temperature: 22 },
] satisfies Array<Measurement & { mode: Mode }>

async function database() {
  const dir = await mkdtemp(join(tmpdir(), 'orquideas-historial-'))
  return { path: join(dir, 'archive.sqlite'), remove: () => rm(dir, { recursive: true, force: true }) }
}

async function start(path: string, source: AcquisitionSource = offlineArduino) {
  const app = createApplication(path, source)
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api`
  const request = (route: string, options?: RequestInit) => fetch(base + route, options)
  async function read<T>(route: string) {
    const response = await request(route)
    assert.equal(response.status, 200)
    return response.json() as Promise<T>
  }
  return { close: app.close, request, read,
    page: (params: string) => read<HistoryPage>('/history/readings?' + params),
    summary: (params: string) => read<HistorySummary>('/history/summary?' + params),
    storage: (value: unknown) => request('/history/storage', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storageMinutes: value }),
    }),
  }
}

async function withRecords(work: (app: Awaited<ReturnType<typeof start>>) => Promise<void>) {
  const fixture = await database()
  try {
    const db = openDatabase(fixture.path)
    try {
      for (const { mode, ...reading } of records) db.record(mode, reading, 1)
    } finally {
      db.close()
    }
    const app = await start(fixture.path)
    try { await work(app) } finally { await app.close() }
  } finally {
    await fixture.remove()
  }
}

test('filtra por fechas inclusivas de Santiago en un día con cambio de hora', () => withRecords(async app => {
  const page = await app.page(period)
  assert.equal(page.total, 3)
  assert.deepEqual(page.rows.map(row => row.time), [records[3].time, records[2].time, records[1].time])
  assert.ok(page.rows.every(row => row.valid))
}))

test('filtra por sensor, origen y condición, incluso cuando se combinan', () => withRecords(async app => {
  assert.deepEqual((await app.page(period + '&sensor=arduino')).rows.map(row => row.sensorId), ['arduino'])
  assert.deepEqual((await app.page(period + '&origin=simulation')).rows.map(row => row.origin), ['simulation', 'simulation'])
  assert.deepEqual((await app.page(period + '&condition=out')).rows.map(row => row.humidity), [91])
  assert.equal((await app.page(period + '&sensor=arduino&origin=simulation')).total, 0)
  assert.equal((await app.read<{ id: string }[]>('/sensors')).length, 2)
}))

test('ordena por fecha, humedad o temperatura y pagina con un orden estable', () => withRecords(async app => {
  for (const key of ['time', 'humidity', 'temperature'] as const) {
    const first = await app.page(period + `&sort=${key}&direction=asc&pageSize=2`)
    const second = await app.page(period + `&sort=${key}&direction=asc&page=2&pageSize=2`)
    assert.equal(first.total, 3)
    assert.equal(first.rows.length, 2)
    assert.equal(second.rows.length, 1)
    assert.equal(second.page, 2)
    assert.ok(first.rows[1][key] < second.rows[0][key])
    const descending = await app.page(period + `&sort=${key}&direction=desc`)
    assert.deepEqual(descending.rows.map(row => row[key]), [...first.rows, ...second.rows].reverse().map(row => row[key]))
  }
}))

test('calcula estadísticas exactas y devuelve series separadas por origen', () => withRecords(async app => {
  const { statistics, series } = await app.summary(period)
  assert.deepEqual(statistics, {
    total: 3, outOfRange: 1, validInRangePercent: 200 / 3,
    humidityAverage: 246 / 3, humidityMin: 75, humidityMax: 91,
    temperatureAverage: 69 / 3, temperatureMin: 18, temperatureMax: 27,
  })
  assert.deepEqual(series.map(group => [group.origin, group.points.length]), [['arduino', 1], ['simulation', 2]])
  assert.equal((await app.summary(period + '&condition=normal')).statistics.validInRangePercent, 100)
  assert.equal((await app.summary(period + '&condition=out')).statistics.validInRangePercent, 0)
}))

test('exporta todo el conjunto filtrado con el orden consultado, y excluye otros orígenes', () => withRecords(async app => {
  const result = await app.request('/history/export.csv?' + period + '&origin=simulation&sort=humidity&direction=asc&pageSize=1')
  assert.equal(result.status, 200)
  assert.match(result.headers.get('content-type') ?? '', /text\/csv/)
  assert.match(result.headers.get('content-disposition') ?? '', /historial-ambiental.csv/)
  const lines = (await result.text()).trim().split('\r\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /America\/Santiago.*Humedad relativa.*Validez/)
  assert.equal(lines[1], '2026-09-06T01:00:00.000-03:00,SIM-01,Simulación,18,75,En rango,Válida')
  assert.match(lines[2], /27,91,Fuera de rango,Válida$/)
  assert.ok(lines.every(line => !line.includes('DHT11-01')))
}))

test('devuelve períodos vacíos sin inventar estadísticas y rechaza consultas inválidas', () => withRecords(async app => {
  const empty = 'period=custom&from=2025-01-01&to=2025-01-02'
  assert.deepEqual((await app.page(empty)).rows, [])
  const summary = await app.summary(empty)
  assert.equal(summary.statistics.total, 0)
  assert.equal(summary.statistics.outOfRange, 0)
  assert.equal(summary.statistics.humidityAverage, null)
  assert.equal(summary.statistics.validInRangePercent, null)
  assert.deepEqual(summary.series, [])
  const exportEmpty = await app.request('/history/export.csv?' + empty)
  assert.equal((await exportEmpty.text()).trim().split('\r\n').length, 1)
  for (const query of [
    'period=wrong', 'period=day&from=2026-09-06', 'period=custom&from=2026-09-06',
    'from=2026-02-29&to=2026-03-01', 'from=2026-01-02&to=2026-01-01',
    'sensor=desconocido', 'origin=desconocido', 'condition=warning',
    'sort=DROP%20TABLE', 'direction=sideways', 'page=0', 'pageSize=101', 'page=1&page=2',
  ]) {
    assert.equal((await app.request('/history/readings?' + query)).status, 400, query)
  }
}))

test('aplica la nueva frecuencia al próximo guardado sin perder telemetría en vivo y persiste al reiniciar', async () => {
  const fixture = await database()
  let publish!: (reading: Measurement) => void
  const source: AcquisitionSource = { mode: 'arduino', connected: true, start(callback) {
    publish = callback
    return () => {}
  } }
  const base = Date.now() - 120_000
  const send = (offset: number, humidity: number) => publish({ time: base + offset, humidity, temperature: 22 })
  try {
    const app = await start(fixture.path, source)
    try {
      send(0, 79)
      send(5_000, 80)
      assert.equal((await app.page('period=day')).total, 1)
      assert.equal((await app.storage('1')).status, 400)
      assert.equal((await app.storage(2)).status, 400)
      for (const option of [5, 15, 30, 60, 1]) {
        const result = await app.storage(option)
        assert.equal(result.status, 200)
        assert.equal((await result.json() as { storageMinutes: number }).storageMinutes, option)
      }
      send(59_999, 81)
      send(60_000, 82)
      send(60_000, 82)
      assert.deepEqual((await app.page('period=day')).rows.map(row => row.humidity), [82, 79])
      send(65_000, 83)
      assert.equal((await app.read<DashboardSnapshot>('/dashboard')).latest?.humidity, 83)
      assert.equal((await app.read<Measurement[]>('/readings?range=live')).length, 5)
      const archive = await app.read<Measurement[]>('/readings?range=day&mode=arduino&archive=1')
      assert.deepEqual(archive.map(row => row.humidity), [79, 82])
    } finally { await app.close() }
    const reopened = await start(fixture.path)
    try {
      assert.equal((await reopened.read<{ storageMinutes: number }>('/history/storage')).storageMinutes, 1)
      assert.deepEqual((await reopened.page('period=day')).rows.map(row => row.humidity), [82, 79])
      assert.equal((await reopened.read<DashboardSnapshot>('/dashboard')).latest?.humidity, 83)
    } finally { await reopened.close() }
  } finally { await fixture.remove() }
})

test('limita el gráfico de períodos densos con puntos almacenados y estadísticas completas', async () => {
  const fixture = await database()
  const count = 800
  const base = Date.now() - count * 60_000 - 1000
  try {
    const db = openDatabase(fixture.path)
    try {
      for (let index = 0; index < count; index++) {
        db.record('simulation', { time: base + index * 60_000, humidity: 80, temperature: 22 }, 1)
      }
    } finally { db.close() }
    const app = await start(fixture.path)
    try {
      const data = await app.summary('period=day')
      assert.equal(data.statistics.total, count)
      assert.equal(data.series[0].points.length, 360)
      assert.equal(data.series[0].points[0].time, base)
      assert.equal(data.series[0].points.at(-1)?.time, base + (count - 1) * 60_000)
      assert.ok(data.series[0].points.every(point => (point.time - base) % 60_000 === 0))
    } finally { await app.close() }
  } finally { await fixture.remove() }
})
