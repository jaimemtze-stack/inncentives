import { describe, expect, it } from 'vitest';
import { currentArea, readCsrfCookie, tokenFromHash } from './api';

describe('api helpers', () => {
  it('reads the CSRF cookie for either area', () => {
    expect(readCsrfCookie('a=1; __Host-inn_portal_csrf=abc.def; b=2')).toBe('abc.def');
    expect(readCsrfCookie('inn_agent_csrf=x.y')).toBe('x.y');
    expect(readCsrfCookie('other=1')).toBeUndefined();
  });
  it('detects the area by hostname', () => {
    expect(currentArea('agentes.soporte.example.mx')).toBe('agent');
    expect(currentArea('agents.localhost')).toBe('agent');
    expect(currentArea('soporte.example.mx')).toBe('portal');
  });
  it('extracts tokens from the URL fragment only when well-formed', () => {
    const t = 'a'.repeat(43);
    expect(tokenFromHash(`#token=${t}`)).toBe(t);
    expect(tokenFromHash('#token=short')).toBeNull();
  });
});
