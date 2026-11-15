import { useId } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Measurement, Range } from '../../shared/telemetry.ts'

const timeZone = 'America/Santiago'
const clock = new Intl.DateTimeFormat('es-CL', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const seconds = new Intl.DateTimeFormat('es-CL', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const date = new Intl.DateTimeFormat('es-CL', { timeZone, day: 'numeric', month: 'short' })
const fullDate = new Intl.DateTimeFormat('es-CL', { timeZone, dateStyle: 'medium', timeStyle: 'medium' })
export const formatReadingTime = (time: number) => fullDate.format(time)

export const rangeLabels: Record<Range, string> = {
  live: 'Tiempo real',
  day: '24 horas',
  week: '7 días',
  month: '30 días',
}

export function ClimateChart({ points, range, simulated }: { points: Measurement[]; range: Range | 'custom'; simulated?: boolean }) {
  const gradient = useId()
  const shortRange = range === 'day' || (range === 'custom' && (points.at(-1)?.time ?? 0) - (points[0]?.time ?? 0) < 86_400_000)
  return (
    <div className="chart-canvas" aria-label="Gráfico de temperatura y humedad">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={points} margin={{ top: 12, right: 0, bottom: 5, left: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#10a779" stopOpacity={.22} />
              <stop offset="100%" stopColor="#10a779" stopOpacity={.015} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e9efec" vertical={false} strokeDasharray="4 4" />
          <XAxis dataKey="time" type="number" domain={['dataMin', 'dataMax']} tickCount={6} minTickGap={24}
            tickFormatter={time => (range === 'live' ? seconds : shortRange ? clock : date).format(time)}
            axisLine={false} tickLine={false} tickMargin={12} tick={{ fill: '#5f716c', fontSize: 11 }} />
          <YAxis yAxisId="humidity" domain={[0, 100]} width={45} tickCount={5} tickFormatter={v => `${v}%`}
            axisLine={false} tickLine={false} tick={{ fill: '#5f716c', fontSize: 11 }} />
          <YAxis yAxisId="temperature" orientation="right" domain={['auto', 'auto']} width={48} tickCount={5}
            tickFormatter={v => `${v}°C`} axisLine={false} tickLine={false} tick={{ fill: '#5f716c', fontSize: 11 }} />
          <Tooltip labelFormatter={value => formatReadingTime(Number(value))}
            formatter={(value, name) => [`${Number(value).toLocaleString('es-CL')} ${name === 'Humedad' ? '%' : '°C'}`, name]}
            contentStyle={{ borderRadius: 12, border: '1px solid #e3ebe7', fontSize: 12, boxShadow: '0 5px 20px #14382815' }} />
          <Area yAxisId="humidity" name="Humedad" dataKey="humidity" type="monotone" stroke="#009b72"
            strokeWidth={2.5} strokeDasharray={simulated ? '5 4' : undefined} fill={`url(#${gradient})`} dot={points.length === 1} isAnimationActive={false} />
          <Line yAxisId="temperature" name="Temperatura" dataKey="temperature" type="monotone"
            stroke="#8b54cf" strokeWidth={2.3} strokeDasharray={simulated ? '5 4' : undefined} dot={points.length === 1} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
