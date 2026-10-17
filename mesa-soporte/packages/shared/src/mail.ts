/** Queue shared by the API (producer) and the worker (consumer). */
export const MAIL_QUEUE = 'mail';

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
    };

export type MailTemplate = MailJob['template'];
