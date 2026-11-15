import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { Temporal } from '@js-temporal/polyfill'
import { WebSocket } from 'ws'
import { createApplication } from './app.ts'
import { openDatabase } from './database.ts'
import { offlineArduino, simulatedReading } from './source.ts'
import { irrigationZone, nextOccurrence, scheduledTime } from '../shared/irrigation.ts'
import type { IrrigationNotification, IrrigationOccurrence, Schedule, ScheduleInput } from '../shared/irrigation.ts'
import type { DashboardSnapshot } from '../shared/telemetry.ts'

const day = '2026-11-16'
const at = (date: string, time: string) => scheduledTime(Temporal.PlainDate.from(date), time)
const sample: ScheduleInput = { date: day, time: '08:00', name: 'Orquídeas del norte', active: true, weekdays: [], recurrence: 'once' }

async function start(path = ':memory:', initialNow = at(day, '07:00')) {
  let now = initialNow
  const app = createApplication(path, offlineArduino, undefined, () => now)
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  const address = app.server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const request = (route: string, method = 'GET', body?: unknown) =>
    fetch(base + '/api/irrigation' + route, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) })
  return {
    close: app.close,
    request,
    socket: () => new WebSocket(base.replace('http:', 'ws:') + '/telemetria'),
    setNow: (value: number) => { now = value },
    snapshot: async () => (await fetch(base + '/api/dashboard')).json() as Promise<DashboardSnapshot>,
    async create(input = sample) {
      const response = await request('/schedules', 'POST', input)
      assert.equal(response.status, 201)
      return response.json() as Promise<Schedule>
    },
    async list<T>(route: string) {
      const response = await request(route)
      assert.equal(response.status, 200)
      return response.json() as Promise<T[]>
    },
  }
}

test('crea, edita, pausa, reactiva y elimina una programación y actualiza el calendario y el dashboard', async () => {
  const app = await start()
  try {
    assert.equal((await app.snapshot()).nextIrrigation, null)
    const socket = app.socket()
    const [initial] = await once(socket, 'message')
    const update = once(socket, 'message')
    const schedule = await app.create()
    assert.equal(schedule.createdAt, schedule.updatedAt)
    const [published] = await update
    assert.notEqual(JSON.parse(published.toString()).irrigationRevision, JSON.parse(initial.toString()).irrigationRevision)
    assert.equal(JSON.parse(published.toString()).nextIrrigation, at(day, '08:00'))
    const updateRoute = '/schedules/' + schedule.id
    app.setNow(at(day, '07:10'))
    const edited = await app.request(updateRoute, 'PUT', { ...sample, name: 'Invernadero principal', time: '09:00' })
    assert.equal(edited.status, 200)
    const revised = await edited.json() as Schedule
    assert.equal(revised.createdAt, schedule.createdAt)
    assert.ok(revised.updatedAt > revised.createdAt)
    assert.equal((await app.snapshot()).nextIrrigation, at(day, '09:00'))
    const month = await app.list<IrrigationOccurrence>('/calendar?month=2026-11')
    assert.equal(month.length, 1)
    assert.equal(month[0].name, 'Invernadero principal')
    assert.deepEqual(await app.list('/calendar?month=2026-12'), [])
    assert.equal((await app.request(updateRoute, 'PUT', { ...revised, active: false })).status, 200)
    assert.equal((await app.snapshot()).nextIrrigation, null)
    assert.equal((await app.request(updateRoute, 'PUT', revised)).status, 200)
    assert.equal((await app.request(updateRoute, 'DELETE')).status, 204)
    assert.equal((await app.request(updateRoute, 'DELETE')).status, 404)
    assert.deepEqual(await app.list('/schedules'), [])
    assert.equal((await app.snapshot()).nextIrrigation, null)
  } finally {
    await app.close()
  }
})

test('valida fecha, hora, nombre, estado y días personalizados en la API', async () => {
  const app = await start()
  try {
    for (const input of [
      { ...sample, date: '2026-02-30' }, { ...sample, date: '2026-13-01' },
      { ...sample, time: '24:00' }, { ...sample, time: '12:60' }, { ...sample, time: '8:00' },
      { ...sample, name: '   ' }, { ...sample, active: 'sí' }, { ...sample, recurrence: 'monthly' },
      { ...sample, recurrence: 'custom', weekdays: [] }, { ...sample, recurrence: 'custom', weekdays: [0, 8] },
      { ...sample, recurrence: 'custom', weekdays: [2, 2] }, { ...sample, time: '06:00' },
    ]) {
      const response = await app.request('/schedules', 'POST', input)
      assert.equal(response.status, 400)
      assert.ok((await response.json() as { error: string }).error)
    }
    assert.equal((await app.request('/calendar?month=2026-19')).status, 400)
    assert.deepEqual(await app.list('/schedules'), [])
  } finally {
    await app.close()
  }
})

test('proyecta recurrencias diarias, semanales y personalizadas desde la fecha inicial', async () => {
  const app = await start()
  try {
    const daily = await app.create({ ...sample, recurrence: 'daily' })
    const weekly = await app.create({ ...sample, recurrence: 'weekly' })
    const custom = await app.create({ ...sample, recurrence: 'custom', weekdays: [2, 4] })
    const month = await app.list<IrrigationOccurrence>('/calendar?month=2026-11')
    const dates = (id: number) => month.filter(item => item.scheduleId === id).map(item => item.scheduledAt)
    assert.deepEqual(dates(daily.id).slice(0, 3), [16, 17, 18].map(date => at(`2026-11-${date}`, '08:00')))
    assert.deepEqual(dates(weekly.id), [16, 23, 30].map(date => at(`2026-11-${date}`, '08:00')))
    assert.deepEqual(dates(custom.id), [17, 19, 24, 26].map(date => at(`2026-11-${date}`, '08:00')))
  } finally {
    await app.close()
  }
})

test('mantiene la hora de Santiago en recurrencias y resuelve horas omitidas y repetidas una sola vez', () => {
  const daily = { ...sample, date: '2026-09-05', time: '08:00', recurrence: 'daily' } as const
  const before = nextOccurrence(daily, at('2026-09-05', '00:00'))!
  const after = nextOccurrence(daily, before + 1)!
  assert.equal(after - before, 23 * 3_600_000)
  const local = (instant: number) => Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(irrigationZone)
  assert.equal(local(before).hour, 8)
  assert.equal(local(after).hour, 8)
  assert.equal(local(at('2026-09-06', '00:30')).hour, 1)
  const repeated = { ...daily, date: '2026-04-04', time: '23:30' }
  const first = nextOccurrence(repeated, at('2026-04-04', '22:00'))!
  assert.equal(local(first).offset, '-03:00')
  assert.equal(local(nextOccurrence(repeated, first + 1)!).day, 5)
})

test('emite un recordatorio al vencer, lo marca leído y evita duplicados', { timeout: 6_000 }, async () => {
  const app = await start()
  try {
    const schedule = await app.create()
    assert.deepEqual(await app.list('/notifications'), [])
    const socket = app.socket()
    await once(socket, 'message')
    const pending = once(socket, 'message')
    app.setNow(at(day, '08:00'))
    const [message] = await pending
    assert.equal(JSON.parse(message.toString()).nextIrrigation, null)
    const [note] = await app.list<IrrigationNotification>('/notifications')
    assert.equal(note.scheduleId, schedule.id)
    assert.equal(note.readAt, null)
    assert.equal((await app.request(`/notifications/${note.id}/read`, 'PATCH')).status, 204)
    await setTimeout(1_100)
    const notes = await app.list<IrrigationNotification>('/notifications')
    assert.equal(notes.length, 1)
    assert.equal(notes[0].readAt, at(day, '08:00'))
    assert.equal((await app.request('/calendar?month=2026-11')).status, 200)
  } finally {
    await app.close()
  }
})

test('registra un riego una vez aunque se reintente, y conserva el nombre tras editar y eliminar', async () => {
  const app = await start()
  try {
    const schedule = await app.create()
    const scheduledAt = at(day, '08:00')
    const payload = { scheduleId: schedule.id, scheduledAt }
    assert.equal((await app.request('/completed', 'POST', { ...payload, scheduledAt: scheduledAt + 60_000 })).status, 409)
    const response = await app.request('/completed', 'POST', payload)
    assert.equal(response.status, 200)
    const finished = await response.json() as IrrigationOccurrence
    assert.equal(finished.completedAt, at(day, '07:00'))
    app.setNow(at(day, '07:30'))
    assert.deepEqual(await (await app.request('/completed', 'POST', payload)).json(), finished)
    assert.equal((await app.snapshot()).nextIrrigation, null)
    assert.equal((await app.request('/schedules/' + schedule.id, 'PUT', { ...sample, name: 'Nombre nuevo', time: '09:00' })).status, 200)
    assert.equal((await app.request('/schedules/' + schedule.id, 'DELETE')).status, 204)
    assert.deepEqual(await app.list('/completed'), [finished])
    assert.deepEqual(await app.list('/calendar?month=2026-11'), [finished])
    assert.deepEqual(await app.list('/notifications'), [])
  } finally {
    await app.close()
  }
})

test('migra la versión 1 conservando telemetría y recupera avisos pendientes al reiniciar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orquideas-riego-'))
  const file = join(dir, 'test.sqlite')
  try {
    const timestamp = at(day, '07:00')
    const db = openDatabase(file)
    db.record('arduino', simulatedReading(timestamp), 60)
    db.close()
    const legacy = new DatabaseSync(file)
    legacy.exec(`DROP TABLE irrigation_events; DROP TABLE irrigation_schedules;
      DROP TABLE latest_sensor_readings; DROP TABLE acquisition_settings;
      DROP INDEX environmental_readings_by_time; DROP TABLE alerts;
      ALTER TABLE system_settings DROP COLUMN staleSeconds;
      ALTER TABLE system_settings DROP COLUMN notifyEnvironment;
      ALTER TABLE system_settings DROP COLUMN notifyBrowser;
      ALTER TABLE system_settings DROP COLUMN notifyIrrigation;
      PRAGMA user_version = 1;`)
    legacy.close()

    const initial = await start(file)
    let id: number
    try {
      id = (await initial.create({ ...sample, recurrence: 'daily' })).id
    } finally {
      await initial.close()
    }
    const restarted = await start(file, at('2026-11-18', '07:00'))
    try {
      assert.equal((await restarted.snapshot()).latest?.time, timestamp)
      assert.equal((await restarted.snapshot()).nextIrrigation, at('2026-11-18', '08:00'))
      assert.equal((await restarted.list<Schedule>('/schedules'))[0].id, id)
      const notifications = await restarted.list<IrrigationNotification>('/notifications')
      assert.deepEqual(notifications.map(note => note.scheduledAt), [at('2026-11-17', '08:00'), at(day, '08:00')])
      assert.equal((await restarted.request(`/notifications/${notifications[0].id}/read`, 'PATCH')).status, 204)
    } finally {
      await restarted.close()
    }

    const again = await start(file, at('2026-11-18', '07:10'))
    try {
      const notifications = await again.list<IrrigationNotification>('/notifications')
      assert.equal(notifications.length, 2)
      assert.equal(notifications[0].readAt, at('2026-11-18', '07:00'))
    } finally {
      await again.close()
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
