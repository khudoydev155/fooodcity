export const API_BASE = "https://worker-production-7c481.up.railway.app";

export function getToken(): string | null {
  return sessionStorage.getItem('admin_token');
}

export function logout(): void {
  sessionStorage.clear();
  window.location.reload();
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });
  if (res.status === 401) logout();
  return await res.json() as T;
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (res.status === 401) logout();
  return await res.json() as T;
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (res.status === 401) logout();
  return await res.json() as T;
}

export async function apiDelete(path: string): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${getToken()}` }
  });
  if (res.status === 401) logout();
  return res;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
