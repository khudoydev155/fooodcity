export const API_BASE: string =
  import.meta.env.VITE_API_BASE ??
  (import.meta.env.DEV ? '' : "https://worker-production-7c481.up.railway.app");

export function getToken(): string | null {
  return sessionStorage.getItem('admin_token');
}

export function logout(): void {
  sessionStorage.clear();
  window.location.reload();
}

function getErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const data = payload as { error?: unknown; reason?: unknown; message?: unknown };
    if (typeof data.error === 'string') return data.error;
    if (typeof data.reason === 'string') return data.reason;
    if (typeof data.message === 'string') return data.message;
  }
  return fallback;
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${getToken() || ''}`);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 401) {
    logout();
    throw new Error("Sessiya tugadi. Qaytadan kiring.");
  }

  const body = await response.text();
  let payload: unknown;
  if (body) {
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      if (response.ok) throw new Error('Serverdan noto‘g‘ri formatdagi javob keldi.');
    }
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `Server xatosi (${response.status})`));
  }
  if (payload && typeof payload === 'object' && 'success' in payload && payload.success === false) {
    throw new Error(getErrorMessage(payload, "So'rov bajarilmadi."));
  }
  if (!body) return undefined as T;
  return payload as T;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  return requestJson<T>(path);
}

export async function apiPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function apiPut<T = unknown>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function apiUploadMenuImage(
  itemId: string,
  file: File
): Promise<{ image_url?: string; image_thumb_url?: string; error?: string }> {
  const formData = new FormData();
  formData.append('image', file);
  return requestJson(`/api/admin/menu/${itemId}/image`, {
    method: 'POST',
    body: formData
  });
}

export async function apiUploadPromotionImage(file: File): Promise<{ image_url: string }> {
  const formData = new FormData();
  formData.append('image', file);
  return requestJson('/api/admin/promotions/upload', {
    method: 'POST',
    body: formData
  });
}

export async function apiDelete(path: string): Promise<void> {
  await requestJson<unknown>(path, { method: 'DELETE' });
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
