import { describe, expect, it } from 'vitest';
import {
  detectSensitiveTable,
  detectSensitiveText,
  maskValue,
  redactSensitiveText,
} from './detector';
import { clabeValid, curpValid, luhnValid, nssValid, rfcValid } from './validators';

// All values are synthetic test data with valid check digits.
const CURP = 'PEXJ900101HDFRRN01';
const RFC_PF = 'PEXJ900101AB1';
const RFC_PM = 'ABC010203XY9';
const CLABE = '002180012345678906';
const NSS = '12345678903';
const CARD = '4111 1111 1111 1111';

describe('validators', () => {
  it('CURP check digit', () => {
    expect(curpValid(CURP)).toBe(true);
    expect(curpValid('PEXJ900101HDFRRN02')).toBe(false);
    expect(curpValid('PEXJ901301HDFRRN01')).toBe(false);
    expect(curpValid('nope')).toBe(false);
  });
  it('RFC structure', () => {
    expect(rfcValid(RFC_PF)).toBe(true);
    expect(rfcValid(RFC_PM)).toBe(true);
    expect(rfcValid('PEXJ901301AB1')).toBe(false);
  });
  it('CLABE check digit', () => {
    expect(clabeValid(CLABE)).toBe(true);
    expect(clabeValid('002180012345678907')).toBe(false);
  });
  it('NSS and Luhn', () => {
    expect(nssValid(NSS)).toBe(true);
    expect(nssValid('12345678904')).toBe(false);
    expect(luhnValid('abc')).toBe(false);
  });
});

describe('detectSensitiveText', () => {
  it('finds each identifier type', () => {
    const r = detectSensitiveText(
      `Empleado con CURP ${CURP}, RFC ${RFC_PF}, NSS ${NSS}, CLABE ${CLABE} y tarjeta ${CARD}. Empresa ${RFC_PM}.`,
    );
    const types = Object.fromEntries(r.findings.map((f) => [f.type, f.count]));
    expect(r.hasSensitiveData).toBe(true);
    expect(types).toEqual({ curp: 1, rfc: 2, clabe: 1, card: 1, nss: 1 });
  });

  it('masks samples', () => {
    const r = detectSensitiveText(`curp: ${CURP.toLowerCase()}`);
    expect(r.findings[0]?.samples[0]).toBe('PE**************01');
    expect(maskValue('123')).toBe('***');
  });

  it('ignores invalid check digits and ordinary numbers', () => {
    const r = detectSensitiveText(
      'Ticket 202610150001, factura 12345678904, folio 0000000000000000, CLABE 002180012345678907, versión 2.3.1',
    );
    expect(r.hasSensitiveData).toBe(false);
  });

  it('does not double count a CLABE as a card', () => {
    const r = detectSensitiveText(`cuenta ${CLABE}`);
    expect(r.findings.map((f) => f.type)).toEqual(['clabe']);
  });

  it('accepts separators in CLABE', () => {
    expect(detectSensitiveText('002 180 01234567890 6').findings[0]?.type).toBe('clabe');
  });
});

describe('detectSensitiveTable', () => {
  it('flags salary columns and identifiers in cells', () => {
    const r = detectSensitiveTable([
      ['Nombre', 'CURP', 'Sueldo mensual', 'Bono'],
      ['Juan Pérez', CURP, 25000, 3000],
    ]);
    const salary = r.findings.find((f) => f.type === 'salary_column');
    expect(salary?.count).toBe(2);
    expect(salary?.samples).toEqual(['Sueldo mensual', 'Bono']);
    expect(r.findings.some((f) => f.type === 'curp')).toBe(true);
  });

  it('a header without data rows is not flagged', () => {
    expect(detectSensitiveTable([['Salario']]).hasSensitiveData).toBe(false);
    expect(detectSensitiveTable([]).hasSensitiveData).toBe(false);
  });
});

describe('redactSensitiveText', () => {
  it('replaces values with labels', () => {
    expect(redactSensitiveText(`CURP ${CURP} y CLABE ${CLABE}`)).toBe(
      'CURP [CURP REDACTADO] y CLABE [CLABE REDACTADO]',
    );
    expect(redactSensitiveText(`nss ${NSS}`, () => '***')).toBe('nss ***');
  });
});
