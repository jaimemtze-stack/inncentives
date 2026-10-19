import { describe, expect, it } from 'vitest';
import { escapeHtml, render } from './templates';

describe('mail templates', () => {
  it('escapes every interpolated value in HTML', () => {
    const m = render({
      template: 'invitation',
      to: 'a@b.mx',
      locale: 'es-MX',
      params: {
        name: '<script>alert(1)</script>',
        inviterName: 'Ana',
        organizationName: 'A&B',
        link: 'https://soporte.example.mx/invitacion#token=abc"onmouseover="x',
        expiresHours: 72,
      },
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('A&amp;B');
    expect(m.html).not.toContain('"onmouseover="');
    expect(m.subject).toBe('Invitación a la mesa de soporte de A&B');
  });

  it('renders English when the locale asks for it', () => {
    const m = render({
      template: 'password_changed',
      to: 'a@b.mx',
      locale: 'en',
      params: { name: 'Ann' },
    });
    expect(m.subject).toBe('Your password was changed');
    expect(m.text).toContain('Hello Ann,');
  });

  it('escapes quotes and ampersands', () => {
    expect(escapeHtml(`"&'<>`)).toBe('&quot;&amp;&#39;&lt;&gt;');
  });
});
