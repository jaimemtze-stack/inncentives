import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const MAX_ENTRIES = 5000;

/** Lists the central directory of a ZIP archive (no ZIP64, no encryption). */
export function zipEntries(buf: Buffer): ZipEntry[] {
  // End of central directory record: search the last 64 KiB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error('Too many ZIP entries');
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
      throw new Error('Corrupt ZIP directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Reads one entry, refusing to inflate more than `maxBytes` (zip bombs).
 */
export function zipRead(buf: Buffer, e: ZipEntry, maxBytes: number): Buffer {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error('Corrupt ZIP entry');
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data.subarray(0, maxBytes);
  if (e.method !== 8) throw new Error('Unsupported ZIP compression');
  return inflateRawSync(data, { maxOutputLength: maxBytes });
}
