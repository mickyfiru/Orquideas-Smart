import { SerialPort } from 'serialport'
import type { Measurement, SerialPortOption, SerialStatus } from '../../shared/telemetry.ts'
import type { AcquisitionSource } from '../source.ts'
import { baudRate, maxLineBytes, parseSensorLine } from './protocol.ts'

interface Link {
  readonly isOpen: boolean
  open(callback: (error: Error | null) => void): void
  close(callback: (error: Error | null) => void): void
  on(event: 'data', handler: (chunk: Buffer) => void): void
  on(event: 'error' | 'close', handler: (error?: Error) => void): void
}
type SerialDriver = {
  list(): Promise<SerialPortOption[]>
  create(path: string): Link
}
const driver: SerialDriver = {
  async list() {
    const ports = await SerialPort.list()
    return ports.map(({ path, manufacturer, vendorId, productId }) => ({
      path, manufacturer: manufacturer ?? null,
      arduinoCandidate: ['2341', '2a03'].includes(vendorId?.toLowerCase() ?? '')
        && ['0043', '0001', '0243'].includes(productId?.toLowerCase() ?? ''),
    }))
  },
  create: path => new SerialPort({ path, baudRate, autoOpen: false, lock: true }),
}

export class SerialConnectionError extends Error {}

export function createSerialAcquisition(binding: SerialDriver = driver, clock = Date.now) {
  let link: Link | null = null
  let publish: ((reading: Measurement) => void) | undefined
  let changed: (() => void) | undefined
  let generation = 0
  let linkGeneration = 0
  let state: SerialStatus = { path: null, state: 'closed', confirmed: false, hasReading: false, lastCommunication: null, error: null }
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(work: () => Promise<T>) => {
    const operation = queue.then(work)
    queue = operation.catch(() => {})
    return operation
  }
  const update = (patch: Partial<SerialStatus>) => {
    state = { ...state, ...patch }
    changed?.()
  }
  const report = (error: string) => {
    if (state.error !== error) update({ error, errorKind: 'communication' })
  }

  async function close() {
    const connection = link
    if (connection?.isOpen) {
      await new Promise<void>((resolve, reject) => connection.close(error => error ? reject(error) : resolve()))
    }
    if (link === connection) link = null
    if (state.state !== 'closed' || state.error) update({ state: 'closed', confirmed: false, hasReading: false, error: null, errorKind: undefined })
  }

  function attach(connection: Link, current: number) {
    let partial = Buffer.alloc(0)
    let discard = false
    connection.on('data', (chunk: Buffer) => {
      if (generation !== current || link !== connection || state.state !== 'open' || !publish) return
      let from = 0
      while (from < chunk.length) {
        const newline = chunk.indexOf(10, from)
        const end = newline === -1 ? chunk.length : newline
        if (!discard && partial.length + end - from > maxLineBytes) {
          partial = Buffer.alloc(0)
          discard = true
          report('Se descartó una línea serie demasiado larga.')
        }
        if (!discard) partial = Buffer.concat([partial, chunk.subarray(from, end)])
        if (newline === -1) break
        if (!discard && partial.toString().trim()) {
          const at = clock()
          const packet = parseSensorLine(partial.toString(), at)
          if (packet.kind === 'invalid') {
            report('Mensaje serie inválido. Verifica el sketch y la velocidad de 9600 baudios.')
          } else if (packet.kind === 'sensor-error') {
            const notify = !state.confirmed || state.error !== 'El DHT11 informó un error de lectura.'
            state = { ...state, confirmed: true, hasReading: false, lastCommunication: at, error: 'El DHT11 informó un error de lectura.', errorKind: 'sensor' }
            if (notify) changed?.()
          } else {
            state = { ...state, confirmed: true, hasReading: true, lastCommunication: at, error: null, errorKind: undefined }
            publish(packet.reading)
          }
        }
        partial = Buffer.alloc(0)
        discard = false
        from = newline + 1
      }
    })
    connection.on('error', () => {
      if (link === connection) report('Error de comunicación con el puerto serie.')
    })
    connection.on('close', error => {
      if (link !== connection) return
      link = null
      update({ state: 'closed', confirmed: false, hasReading: false, error: error ? 'Se perdió la conexión con el puerto serie.' : null, errorKind: undefined })
    })
  }

  const source: AcquisitionSource = {
    mode: 'arduino',
    get connected() { return state.confirmed && state.state === 'open' },
    start(onReading, onStatus) {
      generation++
      publish = onReading
      changed = onStatus
      return () => {
        generation++
        publish = undefined
        changed = undefined
        state = { ...state, confirmed: false, hasReading: false }
        return serialize(close)
      }
    },
  }

  return {
    source,
    status: () => state,
    list: () => binding.list(),
    connect(path: string) {
      const current = generation
      return serialize(async () => {
        if (!publish || generation !== current) throw new SerialConnectionError('Selecciona el modo Arduino antes de conectar.')
        if (link?.isOpen && linkGeneration !== current) await close()
        if (link?.isOpen) {
          if (state.path === path) return
          throw new SerialConnectionError('Desconecta el puerto actual antes de cambiarlo.')
        }
        const available = await binding.list()
        if (!publish || generation !== current) throw new SerialConnectionError('El modo Arduino dejó de estar activo.')
        if (!available.some(port => port.path === path)) {
          throw new SerialConnectionError('El puerto seleccionado ya no está disponible. Busca los puertos nuevamente.')
        }
        update({ path, state: 'opening', confirmed: false, hasReading: false, error: null, errorKind: undefined })
        try {
          const connection = binding.create(path)
          link = connection
          linkGeneration = current
          attach(connection, current)
          await new Promise<void>((resolve, reject) => connection.open(error => error ? reject(error) : resolve()))
          if (!publish || generation !== current) {
            await close()
            throw new SerialConnectionError('El modo Arduino dejó de estar activo.')
          }
          if (link !== connection || !connection.isOpen) throw new Error('Puerto cerrado durante la apertura.')
          update({ state: 'open' })
        } catch (error) {
          if (link?.isOpen) await close()
          link = null
          if (error instanceof SerialConnectionError) throw error
          update({ state: 'closed', confirmed: false, error: 'No se pudo abrir el puerto. Cierra el Monitor Serie u otra aplicación que lo esté usando.', errorKind: 'communication' })
          throw new SerialConnectionError(state.error!)
        }
      })
    },
    disconnect: () => serialize(close),
  }
}
