export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export async function call<T = any>(path: string, token: string | null, method = 'GET', body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Cannot reach the server. It may be waking up, please try again in a minute.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message ?? 'Request failed')
  return data as T
}
