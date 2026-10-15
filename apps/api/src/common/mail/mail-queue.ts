/**
 * Port for transactional e-mails. The API only enqueues; the worker renders and sends
 * through the configured adapter (Graph / SMTP / Mailpit).
 */
export type TransactionalTemplate =
  'invitation' | 'password_reset' | 'password_changed' | 'mfa_changed' | 'new_device_login';

export interface TransactionalMail {
  template: TransactionalTemplate;
  to: string;
  locale: string;
  /** Only allowlisted template variables; never secrets other than the one-time link. */
  vars: Record<string, string>;
}

export interface MailQueue {
  enqueue(mail: TransactionalMail): Promise<void>;
}

export const MAIL_QUEUE = Symbol('MAIL_QUEUE');
export const MAIL_QUEUE_NAME = 'mail-transactional';
