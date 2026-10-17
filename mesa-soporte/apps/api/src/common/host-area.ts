import type { HostArea } from '@mesa/shared';

export function resolveArea(
  hostHeader: string | undefined,
  hosts: { portal: string; agent: string },
): HostArea | null {
  if (!hostHeader) return null;
  const host = hostHeader.trim().toLowerCase();
  if (host === hosts.portal) return 'portal';
  if (host === hosts.agent) return 'agent';
  return null;
}

/** Paths reachable on any host (container health checks use internal names). */
export function isHostAgnosticPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path === '/health' || path === '/ready';
}
