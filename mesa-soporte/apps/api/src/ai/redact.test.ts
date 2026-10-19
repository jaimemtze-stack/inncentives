import { describe, expect, it } from 'vitest';
import { redactForAi } from './redact';

describe('redactForAi', () => {
  it('removes personal and payroll data before text leaves the system', () => {
    const r = redactForAi(
      'Soy Ana, ana.lopez@acme.mx, tel. +52 55 1234 5678, CURP GOLA850101MDFRPN09 y mi CLABE 002010077777777771.',
    );
    expect(r.text).not.toMatch(/acme\.mx|1234 5678|GOLA850101|0020100777/);
    expect(r.text).toContain('[CORREO]');
    expect(r.redactions).toBeGreaterThanOrEqual(3);
    expect(redactForAi('El proceso del 2026 falló en la regla 12').text).toBe(
      'El proceso del 2026 falló en la regla 12',
    );
  });
});
