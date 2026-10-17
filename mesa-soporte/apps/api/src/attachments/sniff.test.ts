import { describe, expect, it } from 'vitest';
import { safeFilename, sniff } from './sniff';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('sniff', () => {
  it('accepts allowed extensions whose content matches', () => {
    expect(sniff(PNG, 'captura.PNG')).toMatchObject({
      ok: true,
      contentType: 'image/png',
      image: true,
    });
    expect(sniff(Buffer.from('a,b\n1,2'), 'datos.csv')).toMatchObject({
      ok: true,
      scanKind: 'text',
    });
    expect(sniff(Buffer.from('%PDF-1.7\n'), 'manual.pdf')).toMatchObject({ ok: true });
  });

  it('rejects dangerous extensions and disguised files', () => {
    expect(sniff(Buffer.from('<svg onload=alert(1)>'), 'x.svg')).toEqual({
      ok: false,
      reason: 'extension_not_allowed',
    });
    expect(sniff(Buffer.from('<html>'), 'x.html')).toEqual({
      ok: false,
      reason: 'extension_not_allowed',
    });
    expect(sniff(Buffer.from('MZ\x90\x00'), 'factura.pdf')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    expect(sniff(PNG, 'notas.txt')).toEqual({ ok: false, reason: 'type_mismatch' });
    expect(sniff(Buffer.from('PK\x03\x04garbage'), 'nomina.xlsx')).toEqual({
      ok: false,
      reason: 'type_mismatch',
    });
    expect(sniff(Buffer.alloc(0), 'a.txt')).toEqual({ ok: false, reason: 'empty' });
  });

  it('sanitises file names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\Users\\a\\re<por>te.pdf')).toBe('re_por_te.pdf');
    expect(safeFilename('...')).toBe('archivo');
  });
});
