'use client';

import { API_URL, readStoredToken } from '@/lib/token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function resolve(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return path.startsWith('/') ? path : `${API_URL}/${path}`;
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);

  const token = readStoredToken();
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return fetch(resolve(path), {
    ...init,
    headers,
    credentials: 'include',
    cache: init.cache ?? 'no-store',
  });
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    const detail =
      (typeof body.detail === 'string' && body.detail) ||
      (typeof body.error === 'string' && body.error) ||
      `Request failed (${response.status})`;
    throw new ApiError(response.status, detail);
  }

  return body as T;
}
