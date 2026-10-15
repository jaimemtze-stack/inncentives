/** Same-origin API client. Session cookie is HttpOnly; the CSRF token is echoed from its cookie. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function readCsrfCookie(cookieString = document.cookie): string | undefined {
  return cookieString
    .split(';')
    .map((c) => c.trim())
    .find((c) => /^(__Host-)?inn_(portal|agent)_csrf=/.test(c))
    ?.split('=')[1];
}

async function ensureCsrf(): Promise<string | undefined> {
  let token = readCsrfCookie();
  if (!token) {
    await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
    token = readCsrfCookie();
  }
  return token;
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    const csrf = await ensureCsrf();
    if (csrf) headers['x-csrf-token'] = csrf;
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    ...(init.body !== undefined
      ? { body: JSON.stringify(init.body) }
      : method !== 'GET'
        ? { body: '{}' }
        : {}),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new ApiError(res.status, data.message ?? 'error');
  return data as T;
}

export interface Me {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  locale: string;
  roles: string[];
  permissions: string[];
  area: 'portal' | 'agent';
  mfaEnabled: boolean;
  mfaSetupRequired: boolean;
}

export const AGENT_HOST_PREFIXES = ['agentes.', 'agents.'];

export function currentArea(hostname = window.location.hostname): 'portal' | 'agent' {
  return AGENT_HOST_PREFIXES.some((p) => hostname.startsWith(p)) ? 'agent' : 'portal';
}

/** Reads a one-time token from the URL fragment (never sent to servers or logged in referrers). */
export function tokenFromHash(hash = window.location.hash): string | null {
  const m = /token=([A-Za-z0-9_-]{43})/.exec(hash);
  return m ? m[1]! : null;
}
