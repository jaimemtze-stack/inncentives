import { zipEntries, zipRead } from '../privacy/zip';

type Family = 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'text' | 'ooxml' | 'odf' | 'cfb';

interface Allowed {
  family: Family;
  contentType: string;
  /** Required top-level folder inside OOXML archives. */
  ooxmlRoot?: string;
  odfMime?: string;
}

/** Extension allow-list. The real type must match the extension. */
const ALLOWED: Record<string, Allowed> = {
  pdf: { family: 'pdf', contentType: 'application/pdf' },
  png: { family: 'png', contentType: 'image/png' },
  jpg: { family: 'jpeg', contentType: 'image/jpeg' },
  jpeg: { family: 'jpeg', contentType: 'image/jpeg' },
  gif: { family: 'gif', contentType: 'image/gif' },
  webp: { family: 'webp', contentType: 'image/webp' },
  txt: { family: 'text', contentType: 'text/plain; charset=utf-8' },
  log: { family: 'text', contentType: 'text/plain; charset=utf-8' },
  csv: { family: 'text', contentType: 'text/csv; charset=utf-8' },
  json: { family: 'text', contentType: 'application/json' },
  xml: { family: 'text', contentType: 'application/xml' },
  eml: { family: 'text', contentType: 'message/rfc822' },
  docx: {
    family: 'ooxml',
    ooxmlRoot: 'word/',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  xlsx: {
    family: 'ooxml',
    ooxmlRoot: 'xl/',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  pptx: {
    family: 'ooxml',
    ooxmlRoot: 'ppt/',
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  odt: {
    family: 'odf',
    odfMime: 'application/vnd.oasis.opendocument.text',
    contentType: 'application/vnd.oasis.opendocument.text',
  },
  ods: {
    family: 'odf',
    odfMime: 'application/vnd.oasis.opendocument.spreadsheet',
    contentType: 'application/vnd.oasis.opendocument.spreadsheet',
  },
  doc: { family: 'cfb', contentType: 'application/msword' },
  xls: { family: 'cfb', contentType: 'application/vnd.ms-excel' },
  msg: { family: 'cfb', contentType: 'application/vnd.ms-outlook' },
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

export type SniffResult =
  | {
      ok: true;
      contentType: string;
      scanKind: 'text' | 'office' | 'other';
      image: boolean;
      ext: string;
    }
  | { ok: false; reason: 'extension_not_allowed' | 'type_mismatch' | 'empty' };

const starts = (b: Buffer, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

function looksLikeText(b: Buffer): boolean {
  const sample = b.subarray(0, 65_536);
  let control = 0;
  for (const c of sample) {
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32)) control++;
  }
  return control <= sample.length / 100;
}

function zipNames(b: Buffer): string[] | null {
  try {
    return zipEntries(b).map((e) => e.name);
  } catch {
    return null;
  }
}

function familyMatches(b: Buffer, a: Allowed): boolean {
  switch (a.family) {
    case 'pdf':
      return starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'png':
      return starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg':
      return starts(b, [0xff, 0xd8, 0xff]);
    case 'gif':
      return starts(b, [0x47, 0x49, 0x46, 0x38]);
    case 'webp':
      return starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8);
    case 'cfb':
      return starts(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'text':
      return looksLikeText(b);
    case 'ooxml': {
      if (!starts(b, [0x50, 0x4b, 0x03, 0x04])) return false;
      const names = zipNames(b);
      return (
        !!names &&
        names.includes('[Content_Types].xml') &&
        names.some((n) => n.startsWith(a.ooxmlRoot!))
      );
    }
    case 'odf': {
      if (!starts(b, [0x50, 0x4b, 0x03, 0x04])) return false;
      try {
        const first = zipEntries(b).find((e) => e.name === 'mimetype');
        return !!first && zipRead(b, first, 200).toString('ascii') === a.odfMime;
      } catch {
        return false;
      }
    }
  }
}

/** Checks the extension allow-list and the real type (magic bytes). */
export function sniff(buf: Buffer, filename: string): SniffResult {
  if (buf.length === 0) return { ok: false, reason: 'empty' };
  const ext = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase() ?? '';
  const allowed = ALLOWED[ext];
  if (!allowed) return { ok: false, reason: 'extension_not_allowed' };
  if (!familyMatches(buf, allowed)) return { ok: false, reason: 'type_mismatch' };
  return {
    ok: true,
    ext,
    contentType: allowed.contentType,
    image: ['png', 'jpeg', 'gif', 'webp'].includes(allowed.family),
    scanKind:
      allowed.family === 'text'
        ? 'text'
        : allowed.family === 'ooxml' || allowed.family === 'odf'
          ? 'office'
          : 'other',
  };
}

/** File name safe for display and Content-Disposition; never used as a path. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(-200);
  return clean || 'archivo';
}
