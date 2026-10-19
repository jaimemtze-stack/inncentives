import { describe, expect, it } from 'vitest';
import { zipEntries, zipRead } from '../privacy/zip';
import { safeCell, toCsv, toXlsx } from './export';

describe('report export', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(safeCell('=HYPERLINK("http://evil")')).toBe(`'=HYPERLINK("http://evil")`);
    expect(safeCell('+1')).toBe("'+1");
    expect(safeCell('-2')).toBe("'-2");
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCell(-2)).toBe(-2);
    expect(safeCell('Hola')).toBe('Hola');
  });

  it('writes CSV with quoting and a BOM', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        ['x,y', '=1+1'],
        ['comillas "', null],
      ],
    );
    expect(csv).toBe('﻿a,b\r\n"x,y",\'=1+1\r\n"comillas """,\r\n');
  });

  it('writes an XLSX workbook with inline strings only', () => {
    const buf = toXlsx(
      'Tickets',
      ['Título', 'Min'],
      [
        ['=cmd|calc', 5],
        ['<b>&', 0],
      ],
    );
    const entries = zipEntries(buf);
    expect(entries.map((e) => e.name)).toContain('xl/worksheets/sheet1.xml');
    const sheet = zipRead(
      buf,
      entries.find((e) => e.name === 'xl/worksheets/sheet1.xml')!,
      1_000_000,
    ).toString();
    expect(sheet).toContain("'=cmd|calc");
    expect(sheet).toContain('&lt;b&gt;&amp;');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('<v>5</v>');
  });
});
