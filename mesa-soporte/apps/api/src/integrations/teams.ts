/** Hosts that serve Teams incoming webhooks and Power Automate / Workflows triggers. */
const TEAMS_HOSTS = [
  /\.webhook\.office\.com$/i,
  /\.logic\.azure\.com$/i,
  /\.environment\.api\.powerplatform\.com$/i,
];

export function isTeamsWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      TEAMS_HOSTS.some((re) => re.test(u.hostname))
    );
  } catch {
    return false;
  }
}

export const teamsUrlAad = (id: string) => `teams:${id}:url`;

export const TeamsEvents = [
  'ticket_created',
  'ticket_assigned',
  'customer_reply',
  'sla_warning',
  'sla_breach',
] as const;

const LABELS: Record<string, string> = {
  ticket_created: 'Ticket nuevo',
  ticket_assigned: 'Ticket asignado',
  customer_reply: 'Respuesta del cliente',
  sla_warning: 'SLA en riesgo',
  sla_breach: 'SLA vencido',
};

/**
 * Adaptive Card with ticket metadata only (number, title, organization,
 * priority, event): never the text of customer messages.
 */
export function teamsCard(t: {
  number: string;
  title: string;
  organization: string | null;
  priority: string;
  event: string;
  url: string;
}) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: `${LABELS[t.event] ?? t.event}: #${t.number}`,
              weight: 'Bolder',
              wrap: true,
            },
            { type: 'TextBlock', text: t.title, wrap: true },
            {
              type: 'FactSet',
              facts: [
                { title: 'Organización', value: t.organization ?? '—' },
                { title: 'Prioridad', value: t.priority },
              ],
            },
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Abrir ticket', url: t.url }],
        },
      },
    ],
  };
}
