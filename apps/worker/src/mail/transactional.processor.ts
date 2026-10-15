import { z } from 'zod';
import type { OutboundMailAdapter } from './adapters';
import { renderMail } from './templates';

export const transactionalJobSchema = z.object({
  template: z.enum([
    'invitation',
    'password_reset',
    'password_changed',
    'mfa_changed',
    'new_device_login',
  ]),
  to: z.string().email().max(254),
  locale: z.string().max(10),
  vars: z.record(z.string().max(2000)),
});

export function createTransactionalProcessor(
  adapter: OutboundMailAdapter,
  from: string,
  productName: string,
) {
  return async (data: unknown) => {
    const job = transactionalJobSchema.parse(data);
    const mail = renderMail(job.template, job.locale, job.vars, productName);
    return adapter.send({ from, to: job.to, ...mail });
  };
}
