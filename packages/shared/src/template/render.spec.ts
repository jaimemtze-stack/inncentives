import { describe, expect, it } from 'vitest';
import { escapeHtml, findUnknownVariables, renderTemplate } from './render';

describe('renderTemplate', () => {
  it('substitutes allowlisted variables', () => {
    expect(
      renderTemplate('Hola {{customer.firstname}}, ticket {{ ticket.number }}', {
        'customer.firstname': 'Ana',
        'ticket.number': '202610150001',
      }),
    ).toBe('Hola Ana, ticket 202610150001');
  });

  it('escapes HTML in values by default', () => {
    expect(
      renderTemplate('{{ticket.title}}', { 'ticket.title': '<img src=x onerror=alert(1)>' }),
    ).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(
      renderTemplate('{{ticket.title}}', { 'ticket.title': '<b>' }, { escapeHtml: false }),
    ).toBe('<b>');
  });

  it('never evaluates expressions or unknown paths', () => {
    expect(renderTemplate('{{ constructor.constructor }}', {})).toBe(
      '{{ constructor.constructor }}',
    );
    expect(renderTemplate('{{ticket.number + 1}}', { 'ticket.number': '1' })).toBe(
      '{{ticket.number + 1}}',
    );
    expect(renderTemplate('{{process.env.SECRET}}', {})).toBe('{{process.env.SECRET}}');
  });

  it('uses a placeholder for missing values and formats dates', () => {
    expect(renderTemplate('{{organization.name}}', {})).toBe('-');
    expect(
      renderTemplate('{{organization.name}}', { 'organization.name': '' }, { missing: '' }),
    ).toBe('');
    expect(
      renderTemplate('{{ticket.created_at}}', {
        'ticket.created_at': new Date('2026-10-15T15:00:00Z'),
      }),
    ).toBe('2026-10-15T15:00:00.000Z');
    expect(renderTemplate('{{ticket.priority}}', { 'ticket.priority': 4 })).toBe('4');
  });

  it('lists unknown variables', () => {
    expect(findUnknownVariables('{{ticket.number}} {{user.password}} {{user.password}}')).toEqual([
      'user.password',
    ]);
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });
});
