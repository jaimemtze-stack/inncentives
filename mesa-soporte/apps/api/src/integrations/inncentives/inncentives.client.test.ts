import { describe, expect, it } from 'vitest';
import { MockInncentivesClient } from './inncentives.client';

describe('MockInncentivesClient', () => {
  const c = new MockInncentivesClient();

  it('returns stable data and nothing for an invalid tenant key', async () => {
    const envs = await c.environments('acme');
    expect(envs.map((e) => e.kind)).toEqual(['production', 'test']);
    expect(await c.environments('ACME/../x')).toEqual([]);
    expect(await c.failedRuns(envs[0]!.id, 1)).toHaveLength(1);
    const events = await c.recentEvents(envs[0]!.id, 50);
    expect(events).toHaveLength(5);
    expect(events[0]!.at.getTime()).toBeGreaterThan(events[1]!.at.getTime());
  });
});
