import { irrigationZone } from '../../shared/irrigation.ts'

export async function irrigationRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api/irrigation' + path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error ?? 'No se pudo completar la solicitud de riego.')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export const irrigationDate = new Intl.DateTimeFormat('es-CL', {
  timeZone: irrigationZone, dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
})
export const irrigationTime = new Intl.DateTimeFormat('es-CL', {
  timeZone: irrigationZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
