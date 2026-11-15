export async function sensorRequest<T>(path: string, method = 'GET', body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/sensors' + path, {
    method, signal,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    throw new Error(failure?.error ?? 'No se pudo comunicar con el servicio de sensores.')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
