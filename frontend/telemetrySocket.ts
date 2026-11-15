import { staleAfter } from '../shared/telemetry.ts'
import type { DashboardSnapshot } from '../shared/telemetry.ts'

type Listener = (snapshot: DashboardSnapshot | null) => void
const listeners = new Set<Listener>()
let socket: WebSocket | undefined
let retry: ReturnType<typeof setTimeout>
let heartbeat: ReturnType<typeof setTimeout>
let last: DashboardSnapshot | null = null

function connect() {
  const url = new URL('/telemetria', window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const connection = new WebSocket(url)
  socket = connection
  const resetHeartbeat = () => {
    clearTimeout(heartbeat)
    heartbeat = setTimeout(() => connection.close(), staleAfter)
  }
  resetHeartbeat()
  connection.onmessage = event => {
    if (socket !== connection) return
    resetHeartbeat()
    last = JSON.parse(event.data) as DashboardSnapshot
    for (const listener of listeners) listener(last)
  }
  connection.onclose = () => {
    if (socket !== connection) return
    clearTimeout(heartbeat)
    last = null
    for (const listener of listeners) listener(null)
    if (listeners.size) retry = setTimeout(connect, 2_000)
  }
}

export function subscribeTelemetry(listener: Listener) {
  listeners.add(listener)
  if (!socket) connect()
  if (last) listener(last)
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    clearTimeout(retry)
    clearTimeout(heartbeat)
    const connection = socket
    socket = undefined
    last = null
    connection?.close()
  }
}
