/**
 * Contract with the Inncentives API (phase 3; the API does not exist yet).
 * The help desk only reads: environments, versions, failed process runs and
 * recent Bitácora events of the customer, to show them beside a ticket.
 * Implementations must time out quickly and never throw for "not found":
 * the sidebar is informative and a ticket must work without it.
 */
export interface InncentivesEnvironment {
  id: string;
  name: string;
  kind: 'production' | 'test' | 'development';
  version: string;
  url: string;
}

export interface InncentivesProcessRun {
  id: string;
  environmentId: string;
  process: string;
  module: string;
  status: 'failed' | 'succeeded' | 'running';
  startedAt: Date;
  finishedAt: Date | null;
  message: string | null;
}

export interface InncentivesLogEvent {
  id: string;
  environmentId: string;
  at: Date;
  module: string;
  action: string;
  user: string | null;
}

export interface InncentivesClient {
  /** Environments of the customer identified by the organization's tenant key. */
  environments(tenantKey: string): Promise<InncentivesEnvironment[]>;
  /** Latest failed process runs, newest first. */
  failedRuns(environmentId: string, limit: number): Promise<InncentivesProcessRun[]>;
  /** Recent Bitácora events, newest first. */
  recentEvents(environmentId: string, limit: number): Promise<InncentivesLogEvent[]>;
}

export const INNCENTIVES_CLIENT = Symbol('INNCENTIVES_CLIENT');

/** Deterministic in-memory data for development, tests and demos. */
export class MockInncentivesClient implements InncentivesClient {
  private readonly base = new Date('2026-10-01T15:00:00Z').getTime();

  async environments(tenantKey: string): Promise<InncentivesEnvironment[]> {
    if (!/^[a-z0-9-]{2,63}$/.test(tenantKey)) return [];
    return [
      {
        id: `${tenantKey}-prod`,
        name: 'Producción',
        kind: 'production',
        version: '2026.9.2',
        url: `https://${tenantKey}.inncentives.example`,
      },
      {
        id: `${tenantKey}-qa`,
        name: 'Pruebas',
        kind: 'test',
        version: '2026.10.0-rc1',
        url: `https://${tenantKey}-qa.inncentives.example`,
      },
    ];
  }

  async failedRuns(environmentId: string, limit: number): Promise<InncentivesProcessRun[]> {
    const runs: InncentivesProcessRun[] = [
      {
        id: `${environmentId}-run-1`,
        environmentId,
        process: 'Cálculo de comisiones',
        module: 'calculo',
        status: 'failed',
        startedAt: new Date(this.base),
        finishedAt: new Date(this.base + 4 * 60_000),
        message: 'Regla "Bono trimestral" sin periodo vigente.',
      },
      {
        id: `${environmentId}-run-2`,
        environmentId,
        process: 'Carga de ventas',
        module: 'cargas',
        status: 'failed',
        startedAt: new Date(this.base - 86_400_000),
        finishedAt: new Date(this.base - 86_400_000 + 60_000),
        message: 'Columna "importe" con formato inválido en la fila 120.',
      },
    ];
    return runs.slice(0, Math.max(0, limit));
  }

  async recentEvents(environmentId: string, limit: number): Promise<InncentivesLogEvent[]> {
    return Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
      id: `${environmentId}-ev-${i + 1}`,
      environmentId,
      at: new Date(this.base - i * 3_600_000),
      module: i % 2 ? 'liquidacion' : 'calculo',
      action: i % 2 ? 'Liquidación publicada' : 'Proceso ejecutado',
      user: i % 3 ? 'admin@cliente.example' : null,
    }));
  }
}
