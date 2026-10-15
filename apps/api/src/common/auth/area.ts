import type { AppConfig } from '../../config/config';
import type { Area } from './actor';

/** Maps the request Host header (without port) to an area; null for unknown hosts. */
export function areaForHost(config: AppConfig, host: string | undefined): Area | null {
  const h = (host ?? '').toLowerCase().replace(/:\d+$/, '');
  if (h === config.AGENT_HOST.toLowerCase()) return 'agent';
  if (h === config.PORTAL_HOST.toLowerCase()) return 'portal';
  return null;
}
