export async function systemRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api' + path, init)
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error ?? 'No se pudo completar la solicitud.')
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export const systemPut = <T>(path: string, body: object) => systemRequest<T>(path, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
