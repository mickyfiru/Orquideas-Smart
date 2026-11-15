import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { createApplication } from './app.ts'
import { openDatabase } from './database.ts'
import { getConnection, offlineArduino, simulatedReading, simulation } from './source.ts'
import type { AcquisitionSource } from './source.ts'
import type { DashboardSnapshot, Measurement } from '../shared/telemetry.ts'

async function listen(app: ReturnType<typeof createApplication>) {
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

test('distingue los cinco estados de adquisición', () => {
  const now = Date.now()
  const reading = simulatedReading(now)
  assert.equal(getConnection('arduino', false, reading, now), 'disconnected')
  assert.equal(getConnection('arduino', true, null, now), 'empty')
  assert.equal(getConnection('arduino', true, reading, now + 21_000), 'stale')
  assert.equal(getConnection('arduino', true, reading, now), 'connected')
  assert.equal(getConnection('simulation', true, reading, now), 'simulation')
})

test('migra, respeta el intervalo de registro y conserva los datos al reabrir SQLite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orquideas-db-'))
  try {
    const path = join(dir, 'test.sqlite')
    const now = Date.now()
    const reading = simulatedReading(now)
    const db = openDatabase(path)
    try {
      db.seedSimulation(now)
      db.seedSimulation(now)
      assert.equal(db.history('simulation', 0, now).length, 720)
      db.record('arduino', reading, 60)
      db.record('arduino', simulatedReading(now + 1_000), 60)
      assert.equal(db.history('arduino', 0, now + 1_000).length, 1)
    } finally {
      db.close()
    }
    const reopened = openDatabase(path)
    try {
      assert.deepEqual({ ...reopened.latest('arduino') }, reading)
      assert.equal(reopened.settings().storageMinutes, 60)
      assert.equal(reopened.history('simulation', 0, now).length, 720)
    } finally {
      reopened.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sirve los cuatro rangos y valida la consulta REST', async () => {
  const app = createApplication(':memory:', simulation)
  try {
    const url = await listen(app)
    const snapshot = await fetch(url + '/api/dashboard').then(r => r.json()) as DashboardSnapshot
    assert.equal(snapshot.connection, 'simulation')
    assert.equal(snapshot.connectedSensors, 0)
    assert.ok(snapshot.latest)
    for (const range of ['live', 'day', 'week', 'month']) {
      const response = await fetch(url + '/api/readings?range=' + range)
      assert.equal(response.status, 200)
      assert.ok((await response.json() as Measurement[]).length > 0)
    }
    assert.equal((await fetch(url + '/api/readings?range=__proto__')).status, 400)
  } finally {
    await app.close()
  }
})

test('publica las lecturas nuevas por WebSocket', { timeout: 4_000 }, async () => {
  let publish!: (reading: Measurement) => void
  const source: AcquisitionSource = {
    mode: 'arduino',
    connected: true,
    start(callback) {
      publish = callback
      return () => {}
    },
  }
  const app = createApplication(':memory:', source)
  try {
    const url = await listen(app)
    const socket = new WebSocket(url.replace('http:', 'ws:') + '/telemetria')
    const [initial] = await once(socket, 'message')
    assert.equal(JSON.parse(initial.toString()).connection, 'empty')
    const update = once(socket, 'message')
    const reading = simulatedReading(Date.now())
    publish(reading)
    const [message] = await update
    assert.deepEqual(JSON.parse(message.toString()).latest, reading)
  } finally {
    await app.close()
  }
})

test('Arduino desconectado no devuelve lecturas ni un sensor conectado', async () => {
  const app = createApplication(':memory:', offlineArduino)
  try {
    const url = await listen(app)
    const snapshot = await fetch(url + '/api/dashboard').then(r => r.json()) as DashboardSnapshot
    assert.equal(snapshot.connection, 'disconnected')
    assert.equal(snapshot.connectedSensors, 0)
    assert.equal(snapshot.latest, null)
    assert.deepEqual(await fetch(url + '/api/readings?range=day').then(r => r.json()), [])
  } finally {
    await app.close()
  }
})
