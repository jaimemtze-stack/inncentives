import sanitize from 'sanitize-html';

/**
 * Allow-list HTML sanitiser for article bodies (e-mail, portal, agent
 * replies). Scripts, styles, event handlers, forms, iframes and remote images
 * are dropped; links get rel="noopener noreferrer nofollow". Inline images are
 * kept as cid: references, which the API rewrites to attachment URLs.
 */
const OPTIONS: sanitize.IOptions = {
  allowedTags: [
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
    'sub',
    'sup',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'width', 'height', 'data-remote-src'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['cid'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'title', 'head'],
  transformTags: {
    // Remote images are blocked by default (tracking pixels, IP leaks): the
    // URL moves to data-remote-src and the UI loads it only on request.
    img: (tagName, attribs) => {
      const { src, ...rest } = attribs;
      if (src && /^https?:\/\//i.test(src))
        return { tagName, attribs: { ...rest, 'data-remote-src': src.slice(0, 2000) } };
      return { tagName, attribs: src ? { ...rest, src } : rest };
    },
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
  },
  allowedAttributesByTag: undefined,
} as sanitize.IOptions;
(OPTIONS.allowedAttributes as Record<string, string[]>).a!.push('rel', 'target');

const MAX_HTML = 1_000_000;

export function sanitizeHtml(html: string): string {
  return sanitize(html.slice(0, MAX_HTML), OPTIONS).trim();
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    // nosemgrep: javascript.lang.security.html-in-template-string.html-in-template-string -- value escaped
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
};

export function htmlToText(html: string): string {
  const withBreaks = html
    .slice(0, MAX_HTML)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ');
  const stripped = sanitize(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['style', 'script', 'head', 'title'],
  });
  return stripped
    .replace(/&(#?\w+);/g, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e]!;
      const code = e.startsWith('#x')
        ? parseInt(e.slice(2), 16)
        : e.startsWith('#')
          ? parseInt(e.slice(1), 10)
          : NaN;
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    })
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
