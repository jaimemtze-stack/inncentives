import { z } from 'zod';
import type {
  InncentivesClient,
  InncentivesEnvironment,
  InncentivesLogEvent,
  InncentivesProcessRun,
} from './inncentives.client';

const TIMEOUT_MS = 5000;
const MAX_BYTES = 1024 * 1024;

const Id = z.string().min(1).max(100);
const Environment = z.object({
  id: Id,
  name: z.string().max(120),
  kind: z.enum(['production', 'test', 'development']),
  version: z.string().max(40),
  url: z.string().url().max(300),
});
const ProcessRun = z.object({
  id: Id,
  environmentId: Id,
  process: z.string().max(200),
  module: z.string().max(60),
  status: z.enum(['failed', 'succeeded', 'running']),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  message: z.string().max(1000).nullable(),
});
const LogEvent = z.object({
  id: Id,
  environmentId: Id,
  at: z.coerce.date(),
  module: z.string().max(60),
  action: z.string().max(200),
  user: z.string().max(254).nullable(),
});
const page = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item).max(100) });

/**
 * Client of the (future) Inncentives API, read-only. The contract is the one
 * proposed in docs/integraciones/api-inncentives.md: bearer token, JSON
 * pages `{ items: [...] }`. Responses are validated and size-limited; no
 * redirects are followed.
 */
export class HttpInncentivesClient implements InncentivesClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:') throw new Error('The Inncentives API must use HTTPS');
    this.base = u.toString().replace(/\/+$/, '');
  }

  private async get<T extends z.ZodTypeAny>(path: string, schema: T): Promise<z.infer<T>> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      headers: { authorization: `Bearer ${this.token}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return schema.parse({ items: [] });
    if (!res.ok) throw new Error(`Inncentives API returned HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error('Inncentives API response too large');
    return schema.parse(JSON.parse(text));
  }

  async environments(tenantKey: string): Promise<InncentivesEnvironment[]> {
    if (!/^[a-z0-9-]{2,63}$/.test(tenantKey)) return [];
    return (await this.get(`/v1/tenants/${tenantKey}/environments`, page(Environment))).items;
  }

  async failedRuns(environmentId: string, limit: number): Promise<InncentivesProcessRun[]> {
    const q = `status=failed&limit=${Math.min(Math.max(limit, 1), 50)}`;
    return (
      await this.get(
        `/v1/environments/${encodeURIComponent(environmentId)}/process-runs?${q}`,
        page(ProcessRun),
      )
    ).items;
  }

  async recentEvents(environmentId: string, limit: number): Promise<InncentivesLogEvent[]> {
    const q = `limit=${Math.min(Math.max(limit, 1), 50)}`;
    return (
      await this.get(
        `/v1/environments/${encodeURIComponent(environmentId)}/log-events?${q}`,
        page(LogEvent),
      )
    ).items;
  }
}
