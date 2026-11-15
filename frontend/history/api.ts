export async function historyRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch('/api/history' + path, init)
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    throw new Error(failure?.error ?? 'No se pudo consultar el historial.')
  }
  return response.json() as Promise<T>
}
