import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { createApplication } from './app.ts'
import { localDate } from '../shared/irrigation.ts'
import type { AcquisitionSource } from './source.ts'
import type { AlertPage, AlertType, NotificationInbox } from '../shared/alerts.ts'
import type { DashboardSnapshot, Measurement } from '../shared/telemetry.ts'

const limits = { humidityTarget: 80, humidityTolerance: 5, temperatureMin: 18, temperatureMax: 24, staleSeconds: 20 }

async function start(path = ':memory:') {
  let now = Date.now()
  let connected = true
  let publish!: (reading: Measurement) => void
  let status!: () => void
  const source: AcquisitionSource = {
    mode: 'arduino', get connected() { return connected },
    start(send, changed) { publish = send; status = changed!; return () => {} },
  }
  const app = createApplication(path, source, undefined, () => now)
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const request = (url: string, method = 'GET', body?: unknown) =>
    fetch(base + '/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  async function read<T>(url: string) {
    const response = await request(url)
    assert.equal(response.status, 200)
    return response.json() as Promise<T>
  }
  return {
    close: app.close, request, read,
    page: (query = '') => read<AlertPage>('/alerts?' + query),
    inbox: () => read<NotificationInbox>('/notifications'),
    snapshot: () => read<DashboardSnapshot>('/dashboard'),
    socket: () => new WebSocket(base.replace('http:', 'ws:') + '/telemetria'),
    send: (humidity: number, temperature: number) => { now += 1000; publish({ time: now, humidity, temperature }) },
    setConnected: (value: boolean) => { connected = value; status() },
    advance: (milliseconds: number) => { now += milliseconds; status() },
    now: () => now,
  }
}
const testCases: Array<[AlertType, number, number, number]> = [
  ['humidity_low', 74, 20, 75], ['humidity_high', 86, 20, 85],
  ['temperature_low', 80, 17, 18], ['temperature_high', 80, 25, 24],
]
for (const [type, humidity, temperature, threshold] of testCases) {
  test(`detecta ${type} y guarda el límite que la disparó`, async () => {
    const app = await start()
    try {
      app.send(humidity, temperature)
      const { rows, total } = await app.page('status=active&type=' + type)
      assert.equal(total, 1)
      assert.equal(rows[0].threshold, threshold)
      assert.equal(rows[0].value, type.startsWith('humidity') ? humidity : temperature)
      assert.equal(rows[0].sensor, 'arduino')
      assert.equal((await app.snapshot()).activeAlerts, 1)
    } finally { await app.close() }
  })
}

test('deduplica una condición y requiere dos lecturas válidas consecutivas para resolver', async () => {
  const app = await start()
  try {
    app.send(74, 20)
    app.send(74, 20)
    app.send(75, 20)
    app.send(74.9, 20)
    assert.equal((await app.page()).total, 1)
    app.send(75, 20)
    app.send(-10, 20)
    assert.equal((await app.snapshot()).latest?.humidity, 75)
    assert.equal((await app.page('status=active')).total, 1)
    app.send(76, 20)
    assert.equal((await app.page('status=resolved')).total, 1)
    app.send(74, 20)
    assert.equal((await app.page()).total, 2)
    assert.equal((await app.page('page=2&pageSize=1')).rows[0].resolvedAt !== null, true)
  } finally { await app.close() }
})

test('registra la pérdida de comunicación real y evita alertas de Arduino al cambiar a simulación', async () => {
  const app = await start()
  try {
    app.send(80, 22)
    app.setConnected(false)
    const [alert] = (await app.page('type=disconnected')).rows
    assert.equal(alert.resolvedAt, null)
    assert.equal((await app.snapshot()).conditions.humidity, 'unavailable')
    assert.equal((await app.inbox()).items[0].kind, 'connection')
    assert.equal((await app.request('/sensors/mode', 'PUT', { mode: 'simulation' })).status, 204)
    app.advance(40_000)
    assert.equal((await app.page('sensor=arduino&status=active')).total, 0)
    assert.equal((await app.page('type=disconnected')).total, 1)
  } finally { await app.close() }
})

test('distingue la falta de respuesta inicial de las lecturas desactualizadas y recupera al recibir datos', async () => {
  const app = await start()
  try {
    app.advance(22_000)
    assert.equal((await app.page('type=no_response&status=active')).total, 1)
    app.send(80, 20)
    assert.equal((await app.page('type=no_response&status=resolved')).total, 1)
    app.advance(22_000)
    assert.equal((await app.page('type=stale&status=active')).total, 1)
    assert.equal((await app.snapshot()).conditions.humidity, 'unavailable')
    app.send(80, 20)
    assert.equal((await app.page('type=stale&status=resolved')).total, 1)
  } finally { await app.close() }
})

test('difunde cambios por WebSocket y separa la lectura del ciclo de vida', { timeout: 5_000 }, async () => {
  const app = await start()
  try {
    const socket = app.socket()
    const [initial] = await once(socket, 'message')
    const update = once(socket, 'message')
    app.send(90, 26)
    const [newState] = await update
    const snapshot = JSON.parse(newState.toString()) as DashboardSnapshot
    assert.notEqual(snapshot.alertsRevision, JSON.parse(initial.toString()).alertsRevision)
    assert.equal(snapshot.activeAlerts, 2)
    const inbox = await app.inbox()
    assert.equal(inbox.unread, 2)
    assert.ok(inbox.items.every(item => item.kind === 'environment'))
    const id = inbox.items[0].id
    const read = once(socket, 'message')
    assert.equal((await app.request(`/alerts/${id}/read`, 'PATCH')).status, 204)
    assert.notEqual(JSON.parse((await read)[0].toString()).alertsRevision, snapshot.alertsRevision)
    assert.equal((await app.inbox()).unread, 1)
    assert.equal((await app.page('status=active')).total, 2)
    assert.equal((await app.page('status=active&read=unread')).total, 1)
  } finally { await app.close() }
})

test('valida configuración y conserva límites originales y alertas tras reiniciar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orquideas-alerts-'))
  const path = join(directory, 'test.sqlite')
  try {
    const app = await start(path)
    try {
      app.send(71, 21)
      for (const overrides of [{ humidityTarget: 110 }, { temperatureMin: 24 }, { staleSeconds: 4 }, { staleSeconds: 5.5 }, { humidityTolerance: '5' }]) {
        assert.equal((await app.request('/settings/environment', 'PUT', { ...limits, ...overrides })).status, 400)
      }
      assert.equal((await app.request('/settings/notifications', 'PUT', { environmental: false })).status, 400)
      assert.equal((await app.request('/alerts?severity=high')).status, 400)
      assert.equal((await app.request('/alerts?status=closed')).status, 400)
      assert.equal((await app.request('/settings/environment', 'PUT', { ...limits, humidityTolerance: 12, staleSeconds: 30 })).status, 200)
      assert.equal((await app.page('type=humidity_low&status=resolved')).rows[0].threshold, 75)
      assert.equal((await app.snapshot()).conditions.humidity, 'normal')
    } finally { await app.close() }
    const reopened = await start(path)
    try {
      const [event] = (await reopened.page()).rows
      assert.equal(event.value, 71)
      assert.equal(event.threshold, 75)
      assert.ok(event.resolvedAt)
      assert.equal((await reopened.snapshot()).settings.staleSeconds, 30)
      assert.equal((await reopened.snapshot()).settings.humidityTolerance, 12)
    } finally { await reopened.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('combina riego y alertas en la campana y aplica preferencias sin descartar eventos', async () => {
  const app = await start()
  try {
    assert.equal((await app.request('/settings/notifications', 'PUT', { environmental: false, browser: false, irrigation: false })).status, 200)
    app.send(80, 27)
    app.setConnected(false)
    const now = app.now()
    const date = localDate(now).toString()
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
    const schedule = await app.request('/irrigation/schedules', 'POST', { name: 'Riego manual', date, time, recurrence: 'once', weekdays: [], active: true })
    assert.equal(schedule.status, 201)
    const muted = await app.inbox()
    assert.equal(muted.unread, 0)
    assert.deepEqual(muted.items, [])
    assert.equal(muted.recent.length, 3)
    assert.equal((await app.page('period=custom&from=' + date + '&to=' + date)).total, 2)
    assert.equal((await app.request('/settings/notifications', 'PUT', { environmental: true, browser: false, irrigation: true })).status, 200)
    const restored = await app.inbox()
    assert.equal(restored.unread, 3)
    assert.deepEqual(new Set(restored.items.map(item => item.kind)), new Set(['irrigation', 'environment', 'connection']))
  } finally { await app.close() }
})
