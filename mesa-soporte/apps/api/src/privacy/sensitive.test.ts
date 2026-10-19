import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { clabeValid, curpValid, detectFile, detectText, luhn, redactText } from './sensitive';

/** Minimal ZIP writer for tests (stored + deflated entries). */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = deflateRawSync(raw);
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('sensitive data detector', () => {
  it('validates check digits', () => {
    expect(curpValid('GODE561231HDFRRN04')).toBe(false);
    expect(curpValid('BADD110313HCMLNS06')).toBe(true);
    expect(luhn('4111111111111111')).toBe(true);
    expect(clabeValid('002010077777777771')).toBe(true);
    expect(clabeValid('002010077777777772')).toBe(false);
  });

  it('finds RFC, CURP, NSS, CLABE and cards but not random numbers', () => {
    const text =
      'Empleado BADD110313HCMLNS06, rfc badd110313ab1, NSS 12345678903, ' +
      'cuenta 002010077777777771, tarjeta 4111 1111 1111 1111, folio 12345678901, pedido 2026101700012';
    const kinds = Object.fromEntries(detectText(text).map((f) => [f.kind, f.count]));
    expect(kinds).toEqual({ curp: 1, rfc: 1, nss: 1, clabe: 1, card: 1 });
    expect(detectText('Ticket 202610170001, total 1500.00, RFC de empresa ABC010101AB1')).toEqual(
      [],
    );
  });

  it('redacts detected values only', () => {
    expect(redactText('CURP BADD110313HCMLNS06 y folio 12345678901')).toBe(
      'CURP [REDACTADO] y folio 12345678901',
    );
  });

  it('detects salary columns in CSV and XLSX', () => {
    expect(
      detectFile(Buffer.from('nombre,puesto,sueldo bruto\nAna,Gerente,50000'), 'text'),
    ).toEqual([{ kind: 'salary_column', count: 1 }]);
    const xlsx = makeZip({
      '[Content_Types].xml': '<Types/>',
      'xl/sharedStrings.xml':
        '<sst><si><t>Nombre</t></si><si><t>Salario</t></si><si><t>BADD110313HCMLNS06</t></si></sst>',
    });
    const found = Object.fromEntries(detectFile(xlsx, 'office').map((f) => [f.kind, f.count]));
    expect(found).toEqual({ salary_column: 1, curp: 1 });
  });
});

describe('buildZip', () => {
  it('round-trips through the ZIP reader', async () => {
    const { buildZip } = await import('./zip-writer');
    const { zipEntries, zipRead } = await import('./zip');
    const zip = buildZip([
      { name: 'datos.json', data: Buffer.from('{"a":1}') },
      { name: 'adjuntos/ñ.txt', data: Buffer.from('hola') },
    ]);
    const entries = zipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(['datos.json', 'adjuntos/ñ.txt']);
    expect(zipRead(zip, entries[1]!, 100).toString()).toBe('hola');
  });
});
