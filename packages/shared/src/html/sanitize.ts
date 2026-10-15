import sanitize from 'sanitize-html';

/**
 * Server-side HTML sanitization for e-mail bodies, the rich-text editor and KB answers.
 * Strict allowlist; remote images are blocked by default (moved to data-remote-src).
 */
export interface SanitizeOptions {
  /** Keep remote http(s) images loadable. Default false. */
  allowRemoteImages?: boolean;
}

const ALLOWED_TAGS = [
  'p',
  'br',
  'div',
  'span',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'sub',
  'sup',
  'blockquote',
  'pre',
  'code',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'a',
  'img',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
];

/** Only absolute URLs with explicit safe schemes; relative or obfuscated URLs are dropped. */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:)/i;
const SAFE_IMG_SRC = /^(https?:\/\/|cid:)/i;

export function sanitizeHtml(html: string, opts: SanitizeOptions = {}): string {
  return sanitize(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'data-remote-src'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      '*': ['dir', 'lang'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['cid', 'https', 'http'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
    transformTags: {
      a: (tagName, attribs) => {
        const { href, ...rest } = attribs;
        const out: Record<string, string> = {
          ...rest,
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        };
        if (href && SAFE_HREF.test(href.trim())) out.href = href.trim();
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => {
        const src = (attribs.src ?? '').trim();
        if (!SAFE_IMG_SRC.test(src)) {
          const { src: _src, ...rest } = attribs;
          return { tagName, attribs: rest };
        }
        if (!opts.allowRemoteImages && /^https?:/i.test(src)) {
          const { src: _src, ...rest } = attribs;
          return { tagName, attribs: { ...rest, 'data-remote-src': src } };
        }
        return { tagName, attribs };
      },
    },
  });
}

/** Plain-text extraction for search indexing and previews. */
export function htmlToText(html: string): string {
  return sanitize(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
