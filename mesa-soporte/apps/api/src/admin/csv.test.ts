import { describe, expect, it } from 'vitest';
import { csvRecords, parseCsv } from './csv';

describe('csv', () => {
  it('parses quotes, escaped quotes and both delimiters', () => {
    expect(parseCsv('a,b\r\n"x, y","di ""hola"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'di "hola"'],
    ]);
    expect(csvRecords('﻿Nombre;Dominios\nACME;acme.mx|acme.com')).toEqual([
      { nombre: 'ACME', dominios: 'acme.mx|acme.com' },
    ]);
  });

  it('rejects broken input and huge files', () => {
    expect(() => parseCsv('a\n"open')).toThrow();
    expect(() => parseCsv(`a\n${'x\n'.repeat(20)}`, 5)).toThrow();
  });
});
