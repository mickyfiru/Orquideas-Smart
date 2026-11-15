import { useEffect, useMemo, useState } from 'react'
import { ranges } from '../../shared/telemetry.ts'
import type { DashboardSnapshot, Measurement, Mode, Range } from '../../shared/telemetry.ts'
import { subscribeTelemetry } from '../telemetrySocket.ts'

async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  if (!response.ok) throw new Error('No se pudo consultar el servidor.')
  return response.json() as Promise<T>
}

export function useTelemetry(range: Range | null) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [transport, setTransport] = useState<'loading' | 'online' | 'offline'>('loading')
  const [series, setSeries] = useState<{ range: Range; mode: Mode; points: Measurement[] } | null>(null)
  const [failed, setFailed] = useState<Range | null>(null)
  const [lastUpdate, setLastUpdate] = useState(0)
  const [realtime, setRealtime] = useState(false)
  const [live, setLive] = useState<{ mode: Mode; points: Measurement[] } | null>(null)
  const mode = snapshot?.mode
  const trackLive = range !== null

  useEffect(() => {
    const controller = new AbortController()
    let socketReported = false
    const accept = (data: DashboardSnapshot) => {
      setSnapshot(data)
      setLastUpdate(Date.now())
      setTransport('online')
    }
    void read<DashboardSnapshot>('/api/dashboard', controller.signal).then(data => {
      if (!controller.signal.aborted && !socketReported) accept(data)
    }).catch(() => {
      if (!controller.signal.aborted && !socketReported) setTransport('offline')
    })

    const unsubscribe = subscribeTelemetry(data => {
      socketReported = true
      if (!data) {
        setRealtime(false)
        setTransport('offline')
        setLive(null)
        return
      }
      setRealtime(true)
      const reading = data.latest
      if (trackLive && reading && !data.conditions.stale && (data.connection === 'simulation' || data.connection === 'connected')) {
        setLive(previous => {
          const points = previous?.mode === data.mode ? previous.points : []
          if (points.at(-1)?.time === reading.time) return previous
          return { mode: data.mode, points: [...points.filter(point => point.time > reading.time - ranges.live), reading] }
        })
      }
      accept(data)
    })
    return () => {
      controller.abort()
      unsubscribe()
    }
  }, [trackLive])

  useEffect(() => {
    if (!range || !mode) return
    const controller = new AbortController()
    let pending = false
    const update = async () => {
      if (pending) return
      pending = true
      try {
        const points = await read<Measurement[]>(`/api/readings?range=${range}&mode=${mode}&archive=1`, controller.signal)
        if (controller.signal.aborted) return
        setSeries({ range, mode, points })
        setFailed(null)
      } catch {
        if (!controller.signal.aborted) setFailed(range)
      } finally {
        pending = false
      }
    }
    void update()
    const timer = setInterval(() => void update(), 60_000)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [range, mode, transport])

  const points = useMemo(() => {
    const stored = series?.range === range && series.mode === mode ? series.points : null
    if (range !== 'live' || !live || live.mode !== mode || !live.points.length) return stored
    const start = live.points[live.points.length - 1].time - ranges.live
    const earlier = stored?.filter(point => point.time >= start && point.time < live.points[0].time) ?? []
    return [...earlier, ...live.points]
  }, [range, mode, series, live])

  return {
    snapshot,
    transport,
    lastUpdate,
    realtime,
    points,
    chartError: failed === range,
  }
}
