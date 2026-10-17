import { describe, expect, it } from 'vitest';
import { renderTemplate } from './render';
import { htmlToText, sanitizeHtml, textToHtml } from './sanitize';

describe('sanitizeHtml', () => {
  it('drops scripts, handlers, styles and dangerous URLs', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">Hola<script>alert(1)</script><style>p{}</style></p>' +
        '<a href="javascript:alert(1)">x</a><img src="https://evil.test/p.gif"><iframe src="x"></iframe>',
    );
    expect(out).not.toMatch(/script|onclick|style|javascript|iframe| src="https/);
    expect(out).toContain('data-remote-src="https://evil.test/p.gif"');
    expect(out).toContain('<p>Hola</p>');
  });

  it('keeps safe links with rel and cid images', () => {
    const out = sanitizeHtml('<a href="https://inncentives.mx">i</a><img src="cid:logo@x">');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('src="cid:logo@x"');
  });

  it('converts between text and html', () => {
    expect(textToHtml('a <b>\n\nc')).toBe('<p>a &lt;b&gt;</p><p>c</p>');
    expect(htmlToText('<p>Uno&nbsp;&amp; dos</p><ul><li>x</li></ul><script>bad()</script>')).toBe(
      'Uno & dos\n- x',
    );
  });
});

describe('renderTemplate', () => {
  it('only renders allow-listed variables and escapes HTML', () => {
    const tpl = 'Hola {{customer.name}} {{ticket.number}} {{process.env.SECRET}} {{constructor}}';
    expect(renderTemplate(tpl, { 'customer.name': '<b>Ana</b>', 'ticket.number': '1' }, true)).toBe(
      'Hola &lt;b&gt;Ana&lt;/b&gt; 1  ',
    );
    expect(renderTemplate(tpl, { 'customer.name': '<b>Ana</b>' }, false)).toBe(
      'Hola <b>Ana</b>   ',
    );
  });
});
