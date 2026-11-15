import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { createApplication } from './app.ts'
import { createSerialAcquisition } from './sensors/serial.ts'
import { parseSensorLine } from './sensors/protocol.ts'
import { evaluateEnvironment } from '../shared/telemetry.ts'
import type { DashboardSnapshot, Measurement, Mode } from '../shared/telemetry.ts'
import type { AlertPage } from '../shared/alerts.ts'

const valid = JSON.stringify({ sensorId: 'DHT11-01', status: 'ok', humidity: 79, temperature: 22, time: 1 })
const failure = '{"sensorId":"DHT11-01","status":"error","code":"DHT_READ_FAILED"}'
const settings = { humidityTarget: 80, humidityTolerance: 5, temperatureMin: 18, temperatureMax: 24, storageMinutes: 60 }

class MockLink extends EventEmitter {
  isOpen = false

  open(callback?: (error: Error | null) => void) {
    this.isOpen = true
    callback?.(null)
  }

  close(callback?: (error: Error | null) => void) {
    this.isOpen = false
    this.emit('close')
    callback?.(null)
  }

  send(text: string) {
    this.emit('data', Buffer.from(text))
  }

  unplug() {
    this.isOpen = false
    this.emit('close', new Error('disconnected'))
  }
}

function hardware() {
  const links: MockLink[] = []
  let timestamp = Date.now()
  const serial = createSerialAcquisition({
    list: async () => [{ path: 'COM12', manufacturer: 'Test', arduinoCandidate: true }],
    create: () => {
      const link = new MockLink()
      links.push(link)
      return link
    },
  }, () => timestamp)
  return { serial, links, setTime: (value: number) => { timestamp = value } }
}

async function start(path = ':memory:', mode: Mode | null = 'simulation', mock = hardware()) {
  const app = createApplication(path, mode, undefined, Date.now, mock.serial)
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const request = (route: string, method = 'GET', body?: object) => fetch(base + '/api' + route, {
    method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
  })
  return { ...mock, request, close: app.close,
    snapshot: async () => (await request('/dashboard')).json() as Promise<DashboardSnapshot>,
    points: async (range = 'live') => (await request('/readings?range=' + range)).json() as Promise<Measurement[]>,
    socket: () => new WebSocket(base.replace('http:', 'ws:') + '/telemetria'),
  }
}

test('valida tramas JSON del Arduino y usa el tiempo de recepción', () => {
  assert.deepEqual(parseSensorLine(valid + '\r', 1234), {
    kind: 'reading', reading: { humidity: 79, temperature: 22, time: 1234 },
  })
  assert.deepEqual(parseSensorLine(failure, 1234), { kind: 'sensor-error' })
  for (const value of [
    '', 'not JSON', 'null', '[]', valid.replace('DHT11-01', 'otro'),
    valid.replace('79', '101'), valid.replace('79', '-1'), valid.replace('22', '51'),
    valid.replace('79', '"79"'), valid.replace('79', '1e999'), valid.replace('"ok"', '"unknown"'),
    '{ "sensorId": "DHT11-01", "status": "ok" }', ' '.repeat(600) + valid,
  ]) assert.equal(parseSensorLine(value, 0).kind, 'invalid', value)
})

test('aplica límites inclusivos de humedad y temperatura, con datos anteriores sin evaluación', () => {
  const data = (humidity: number, temperature: number) => ({ humidity, temperature, time: 1 })
  const low = evaluateEnvironment(data(74.9, 17.9), 'connected', settings)
  assert.equal(low.humidity, 'low')
  assert.equal(low.temperature, 'low')
  const high = evaluateEnvironment(data(85.1, 24.1), 'connected', settings)
  assert.equal(high.humidity, 'high')
  assert.equal(high.temperature, 'high')
  for (const [humidity, temperature] of [[75, 18], [85, 24]]) {
    const normal = evaluateEnvironment(data(humidity, temperature), 'simulation', settings)
    assert.equal(normal.humidity, 'normal')
    assert.equal(normal.temperature, 'normal')
  }
  const stale = evaluateEnvironment(data(80, 21), 'disconnected', settings)
  assert.equal(stale.stale, true)
  assert.equal(stale.humidity, 'unavailable')
  assert.equal(stale.temperature, 'unavailable')
})

test('cambia de modo, valida la selección de puerto y serializa aperturas concurrentes', async () => {
  const app = await start()
  try {
    assert.equal((await app.snapshot()).connection, 'simulation')
    assert.ok((await app.points()).length)
    assert.equal((await app.request('/sensors/connect', 'POST', { path: 'COM12' })).status, 409)
    assert.equal((await app.request('/sensors/mode', 'PUT', { mode: 'arduino' })).status, 204)
    assert.equal((await app.snapshot()).latest, null)
    assert.deepEqual(await app.points(), [])
    assert.deepEqual(await app.points('day'), [])
    assert.equal((await app.request('/sensors/connect', 'POST', { path: 'COM3' })).status, 409)
    const ports = await (await app.request('/sensors/ports')).json() as {path: string}[]
    assert.equal(ports[0].path, 'COM12')
    const results = await Promise.all(Array.from({ length: 3 }, () => app.request('/sensors/connect', 'POST', { path: 'COM12' })))
    assert.deepEqual(results.map(response => response.status), [204, 204, 204])
    assert.equal(app.links.length, 1)
    const unverified = await app.snapshot()
    assert.equal(unverified.serial.state, 'open')
    assert.equal(unverified.connectedSensors, 0)
    assert.equal(unverified.latest, null)
    assert.equal((await app.request('/sensors/mode', 'PUT', { mode: 'simulation' })).status, 204)
    assert.equal((await app.snapshot()).connection, 'simulation')
    assert.equal(app.links[0].isOpen, false)
  } finally {
    await app.close()
  }
})

test('recibe bytes fragmentados, publica datos y conserva la última lectura al desconectar y reconectar', { timeout: 5_000 }, async () => {
  const app = await start(':memory:', 'arduino')
  try {
    assert.equal((await app.request('/sensors/connect', 'POST', { path: 'COM12' })).status, 204)
    const link = app.links[0]
    link.send('x'.repeat(600))
    link.send('\n' + failure + '\r\n')
    const sensorError = await app.snapshot()
    assert.equal(sensorError.connection, 'empty')
    assert.equal(sensorError.serial.confirmed, true)
    assert.match(sensorError.serial.error ?? '', /error de lectura/)
    const socket = app.socket()
    await once(socket, 'message')
    const reading = once(socket, 'message')
    link.send(valid.slice(0, 40))
    assert.deepEqual(await app.points(), [])
    link.send(valid.slice(40) + '\r\n')
    const [message] = await reading
    const received = JSON.parse(message.toString()) as DashboardSnapshot
    assert.equal(received.mode, 'arduino')
    assert.equal(received.connection, 'connected')
    assert.equal(received.connectedSensors, 1)
    assert.equal(received.latest?.humidity, 79)
    assert.equal(received.serial.error, null)
    assert.equal(received.latest?.time, received.serial.lastCommunication)
    const disconnected = once(socket, 'message')
    link.unplug()
    const [status] = await disconnected
    const stale = JSON.parse(status.toString()) as DashboardSnapshot
    assert.equal(stale.connection, 'disconnected')
    assert.equal(stale.conditions.stale, true)
    assert.deepEqual(stale.latest, received.latest)
    assert.equal(stale.connectedSensors, 0)
    link.send(valid.replace('79', '90') + '\n')
    assert.deepEqual((await app.snapshot()).latest, received.latest)
    assert.equal((await app.request('/sensors/connect', 'POST', { path: 'COM12' })).status, 204)
    assert.equal(app.links.length, 2)
    assert.equal((await app.snapshot()).serial.confirmed, false)
    app.links[1].send(failure + '\n')
    assert.equal((await app.snapshot()).connection, 'stale')
  } finally {
    await app.close()
  }
})

test('persiste la última lectura física, el puerto, el modo y la tolerancia tras reiniciar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orquideas-sensor-'))
  const path = join(directory, 'db.sqlite')
  try {
    const app = await start(path)
    let last: Measurement | null
    try {
      assert.equal((await app.request('/sensors/mode', 'PUT', { mode: 'arduino' })).status, 204)
      assert.equal((await app.request('/sensors/connect', 'POST', { path: 'COM12' })).status, 204)
      assert.equal((await app.request('/sensors/humidity-tolerance', 'PUT', { value: -1 })).status, 400)
      assert.equal((await app.request('/sensors/humidity-tolerance', 'PUT', { value: 0.5 })).status, 204)
      const at = Date.now() - 1_000
      app.setTime(at)
      app.links[0].send(valid + '\n')
      app.setTime(at + 100)
      app.links[0].send(valid.replace('79', '82').replace('22', '27') + '\n')
      const state = await app.snapshot()
      assert.equal(state.conditions.humidity, 'high')
      assert.equal(state.conditions.temperature, 'high')
      assert.equal(state.latest?.humidity, 82)
      last = state.latest
      assert.equal((await app.points('day')).length, 2)
    } finally {
      await app.close()
    }
    const reopened = await start(path, null)
    try {
      const state = await reopened.snapshot()
      assert.equal(state.mode, 'arduino')
      assert.equal(state.connection, 'disconnected')
      assert.deepEqual(state.latest, last)
      assert.equal(state.conditions.stale, true)
      assert.equal(state.serial.path, 'COM12')
      assert.equal(state.settings.humidityTolerance, 0.5)
      assert.deepEqual(await reopened.points(), [])
      assert.equal((await reopened.points('day')).at(-1)?.humidity, 82)
    } finally {
      await reopened.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('registra errores de trama y de sensor, evita repetirlos y recupera tras una trama válida', async () => {
  const app = await start(':memory:', 'arduino')
  const alerts = async (type: string) => (await app.request('/alerts?type=' + type)).json() as Promise<AlertPage>
  try {
    assert.equal((await app.request('/sensors/connect', 'POST', { path: 'COM12' })).status, 204)
    const port = app.links[0]
    port.send(valid + '\n')
    port.send('trama rota\ntrama rota\n')
    assert.equal((await app.snapshot()).conditions.humidity, 'unavailable')
    const communication = await alerts('communication')
    assert.equal(communication.total, 1)
    assert.equal(communication.rows[0].resolvedAt, null)
    port.send(failure + '\n')
    assert.equal((await alerts('no_response')).rows[0].resolvedAt, null)
    port.send(valid + '\n')
    assert.ok((await alerts('no_response')).rows[0].resolvedAt)
    assert.ok((await alerts('communication')).rows[0].resolvedAt)
    assert.equal((await app.snapshot()).conditions.humidity, 'normal')
  } finally { await app.close() }
})
