import type { ApiErrorBody, ErrorCode } from '@mesa/shared';

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/**
 * Same-origin JSON client. Cookies travel automatically (HttpOnly, never read
 * by JS); state-changing requests carry the per-session CSRF token.
 */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    const retry = Number(res.headers.get('Retry-After')) || undefined;
    throw new ApiError(
      res.status,
      err?.code ?? 'internal_error',
      err?.message ?? res.statusText,
      retry,
    );
  }
  if (data && typeof data === 'object' && 'csrfToken' in data) {
    setCsrfToken((data as { csrfToken: string }).csrfToken);
  }
  return data as T;
}

/** Reads `#token=...` once and removes it from the address bar and history. */
export function takeFragmentToken(): string | null {
  const m = /[#&]token=([A-Za-z0-9_-]{43})/.exec(window.location.hash);
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return m?.[1] ?? null;
}

/** Multipart upload of one file to the staging area; returns the attachment id. */
export async function uploadFile(
  file: File,
): Promise<{ id: string; filename: string; size: number }> {
  const form = new FormData();
  form.append('file', file, file.name);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch('/api/v1/attachments', {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: form,
  });
  const data = (await res.json().catch(() => undefined)) as unknown;
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'internal_error', err?.message ?? res.statusText);
  }
  return data as { id: string; filename: string; size: number };
}
