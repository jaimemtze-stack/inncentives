import { describe, expect, it } from 'vitest';
import { escapeCsvCell, neutralizeFormula, toCsv } from './escape';

describe('CSV formula injection', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\t=x', '\r=x'])('neutralizes %j', (v) => {
    expect(neutralizeFormula(v).startsWith("'")).toBe(true);
  });
  it('leaves safe values alone', () => {
    expect(neutralizeFormula('hola')).toBe('hola');
    expect(neutralizeFormula(42)).toBe('42');
    expect(neutralizeFormula(null)).toBe('');
    expect(neutralizeFormula(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });
  it('quotes when needed', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('di "hola"')).toBe('"di ""hola"""');
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(
      toCsv([
        ['a', 'b'],
        [1, '=2'],
      ]),
    ).toBe("a,b\r\n1,'=2");
    expect(toCsv([['a;b', 'c']], ';')).toBe('"a;b";c');
  });
});
