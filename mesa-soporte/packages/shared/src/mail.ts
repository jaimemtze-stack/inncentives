/** Queue shared by the API (producer) and the worker (consumer). */
export const MAIL_QUEUE = 'mail';
/** Queues processed by the jobs service (same code base as the API). */
export const JobQueues = {
  /** Outbound ticket e-mail, one job per article. */
  outbound: 'outbound',
  /** Trigger webhooks. */
  webhooks: 'webhooks',
  /** Antivirus and sensitive-data scan of new attachments. */
  scan: 'scan',
  /** Periodic work: mail fetch, SLA checks, schedulers, retention. */
  maintenance: 'maintenance',
} as const;

export type MailJob =
  | {
      template: 'invitation';
      to: string;
      locale: string;
      params: {
        name: string;
        inviterName: string;
        organizationName: string;
        link: string;
        expiresHours: number;
      };
    }
  | {
      template: 'password_reset';
      to: string;
      locale: string;
      params: { name: string; link: string; expiresMinutes: number };
    }
  | { template: 'password_changed'; to: string; locale: string; params: { name: string } }
  | { template: 'mfa_enabled'; to: string; locale: string; params: { name: string } }
  | { template: 'mfa_disabled'; to: string; locale: string; params: { name: string } }
  | {
      template: 'new_device_login';
      to: string;
      locale: string;
      params: { name: string; ip: string; userAgent: string; when: string };
    }
  | {
      template: 'ticket_notification';
      to: string;
      locale: string;
      params: { name: string; subject: string; body: string; link: string };
    };

export type MailTemplate = MailJob['template'];
