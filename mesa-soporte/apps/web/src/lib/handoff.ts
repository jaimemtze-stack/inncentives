/**
 * Hand-off from Inncentives: the widget opens `/reportar#ctx=<token>` or
 * `/chat#widget`. The token is moved out of the address bar (it never reaches
 * logs or Referer) into session storage, so it survives the sign-in steps.
 */
const CTX_KEY = 'mesa.widget.ctx';
const RETURN_KEY = 'mesa.returnTo';
const RETURNABLE = new Set(['/reportar', '/chat']);

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Runs once at start-up, before the router reads the URL. */
export function captureHandoff(): void {
  const { pathname, hash, search } = window.location;
  if (!RETURNABLE.has(pathname)) return;
  const m = /[#&]ctx=([A-Za-z0-9_.-]{20,4000})/.exec(hash);
  try {
    if (m) store()?.setItem(CTX_KEY, m[1]!);
    if (pathname === '/chat' && /widget/.test(hash)) store()?.setItem('mesa.chat.origin', 'widget');
    store()?.setItem(RETURN_KEY, pathname);
  } catch {
    // Storage blocked: the page still works once signed in, without the context.
  }
  if (hash) window.history.replaceState(null, '', pathname + search);
}

/** Where to go after signing in, if a hand-off is pending. */
export function pendingReturnTo(): string | null {
  try {
    const v = store()?.getItem(RETURN_KEY) ?? null;
    return v && RETURNABLE.has(v) ? v : null;
  } catch {
    return null;
  }
}

/** Called by the hand-off page once it is shown. */
export function clearReturnTo(): void {
  try {
    store()?.removeItem(RETURN_KEY);
  } catch {
    // ignore
  }
}

export function widgetToken(): string | null {
  try {
    return store()?.getItem(CTX_KEY) ?? null;
  } catch {
    return null;
  }
}

export function clearWidgetToken(): void {
  try {
    store()?.removeItem(CTX_KEY);
  } catch {
    // ignore
  }
}

export function chatOrigin(): 'portal' | 'widget' {
  try {
    return store()?.getItem('mesa.chat.origin') === 'widget' ? 'widget' : 'portal';
  } catch {
    return 'portal';
  }
}
