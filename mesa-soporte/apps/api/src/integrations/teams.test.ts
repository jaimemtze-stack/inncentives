import { describe, expect, it } from 'vitest';
import { isTeamsWebhookUrl, teamsCard } from './teams';

describe('teams', () => {
  it('accepts only Teams / Workflows HTTPS hosts', () => {
    expect(isTeamsWebhookUrl('https://neitek.webhook.office.com/webhookb2/abc')).toBe(true);
    expect(isTeamsWebhookUrl('https://prod-12.westus.logic.azure.com:443/workflows/x')).toBe(true);
    expect(isTeamsWebhookUrl('http://neitek.webhook.office.com/x')).toBe(false);
    expect(isTeamsWebhookUrl('https://evil.example/webhook.office.com')).toBe(false);
    expect(isTeamsWebhookUrl('https://webhook.office.com.evil.example/x')).toBe(false);
  });

  it('builds a card with metadata only', () => {
    const card = JSON.stringify(
      teamsCard({
        number: '1',
        title: 'Error',
        organization: 'ACME',
        priority: 'alta',
        event: 'customer_reply',
        url: 'https://x',
      }),
    );
    expect(card).toContain('Respuesta del cliente: #1');
    expect(card).toContain('AdaptiveCard');
  });
});
