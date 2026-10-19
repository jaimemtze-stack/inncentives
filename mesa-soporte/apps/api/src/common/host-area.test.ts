import { describe, expect, it } from 'vitest';
import { isHostAgnosticPath, resolveArea } from './host-area';

const hosts = { portal: 'soporte.example.mx', agent: 'agentes.soporte.example.mx' };

describe('resolveArea', () => {
  it('maps exact hosts only', () => {
    expect(resolveArea('soporte.example.mx', hosts)).toBe('portal');
    expect(resolveArea('AGENTES.soporte.example.mx', hosts)).toBe('agent');
    expect(resolveArea('evil.example.mx', hosts)).toBeNull();
    expect(resolveArea('soporte.example.mx.evil.com', hosts)).toBeNull();
    expect(resolveArea(undefined, hosts)).toBeNull();
  });

  it('lets health checks through on any host', () => {
    expect(isHostAgnosticPath('/health')).toBe(true);
    expect(isHostAgnosticPath('/ready?x=1')).toBe(true);
    expect(isHostAgnosticPath('/api/v1/auth/me')).toBe(false);
  });
});
