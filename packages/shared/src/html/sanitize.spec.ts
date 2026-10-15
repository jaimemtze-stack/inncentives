import { describe, expect, it } from 'vitest';
import { htmlToText, sanitizeHtml } from './sanitize';

// Vectors adapted from the OWASP XSS Filter Evasion Cheat Sheet.
const VECTORS = [
  '<script>alert(1)</script>',
  '<IMG SRC="javascript:alert(\'XSS\');">',
  '<IMG SRC=JaVaScRiPt:alert(1)>',
  '<IMG SRC=`javascript:alert("RSnake says, \'XSS\'")`>',
  '<IMG """><SCRIPT>alert("XSS")</SCRIPT>">',
  '<IMG SRC=# onmouseover="alert(1)">',
  '<IMG SRC=/ onerror="alert(String.fromCharCode(88,83,83))"></img>',
  '<IMG SRC=&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;&#97;&#108;&#101;&#114;&#116;&#40;&#39;&#88;&#83;&#83;&#39;&#41;>',
  '<IMG SRC="jav&#x09;ascript:alert(1);">',
  '<a href="javascript:alert(1)">x</a>',
  '<a href=" &#14;  javascript:alert(1)">x</a>',
  '<svg/onload=alert(1)>',
  '<BODY ONLOAD=alert(1)>',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="x"></object><embed src="x">',
  '<STYLE>li {list-style-image: url("javascript:alert(1)");}</STYLE><UL><LI>XSS</br>',
  '<DIV STYLE="background-image: url(javascript:alert(1))">',
  '<META HTTP-EQUIV="refresh" CONTENT="0;url=javascript:alert(1);">',
  '<form action="https://evil"><input name=x></form>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
];

describe('sanitizeHtml', () => {
  it.each(VECTORS)('neutralizes %s', (v) => {
    const out = sanitizeHtml(v).toLowerCase();
    expect(out).not.toMatch(/<script|<iframe|<object|<embed|<svg|<style|<meta|<form|<input/);
    expect(out).not.toMatch(/\son\w+=/);
    expect(out).not.toMatch(/javascript:|data:text/);
    expect(out).not.toMatch(/style=/);
  });

  it('keeps safe formatting and hardens links', () => {
    const out = sanitizeHtml('<p><b>Hola</b> <a href="https://inncentives.mx">doc</a></p>');
    expect(out).toContain('<b>Hola</b>');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });

  it('blocks remote images unless allowed, keeps cid images', () => {
    expect(sanitizeHtml('<img src="https://tracker.example/p.gif">')).toBe(
      '<img data-remote-src="https://tracker.example/p.gif" />',
    );
    expect(
      sanitizeHtml('<img src="https://x.example/a.png">', { allowRemoteImages: true }),
    ).toContain('src="https://x.example/a.png"');
    expect(sanitizeHtml('<img src="cid:abc@x">')).toContain('src="cid:abc@x"');
  });

  it('extracts text', () => {
    expect(htmlToText('<p>Hola&nbsp;<b>mundo</b></p><script>x</script>')).toBe('Hola mundo');
  });
});
