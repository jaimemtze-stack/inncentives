import type { MailJob } from '@mesa/shared';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Lang = 'es' | 'en';
const lang = (locale: string): Lang => (locale.toLowerCase().startsWith('en') ? 'en' : 'es');

interface Body {
  subject: string;
  lines: string[];
  link?: { href: string; label: string };
}

function bodyFor(job: MailJob, l: Lang): Body {
  switch (job.template) {
    case 'invitation': {
      const p = job.params;
      return l === 'en'
        ? {
            subject: `Invitation to ${p.organizationName} support`,
            lines: [
              `Hello ${p.name},`,
              `${p.inviterName} invited you to the Inncentives support desk for ${p.organizationName}.`,
              `The link expires in ${p.expiresHours} hours and works only once.`,
            ],
            link: { href: p.link, label: 'Accept invitation' },
          }
        : {
            subject: `Invitación a la mesa de soporte de ${p.organizationName}`,
            lines: [
              `Hola ${p.name}:`,
              `${p.inviterName} te invitó a la mesa de soporte de Inncentives para ${p.organizationName}.`,
              `El enlace vence en ${p.expiresHours} horas y solo se puede usar una vez.`,
            ],
            link: { href: p.link, label: 'Aceptar invitación' },
          };
    }
    case 'password_reset': {
      const p = job.params;
      return l === 'en'
        ? {
            subject: 'Reset your password',
            lines: [
              `Hello ${p.name},`,
              `Use this link to choose a new password. It expires in ${p.expiresMinutes} minutes.`,
              'If you did not ask for it, ignore this email.',
            ],
            link: { href: p.link, label: 'Reset password' },
          }
        : {
            subject: 'Restablece tu contraseña',
            lines: [
              `Hola ${p.name}:`,
              `Usa este enlace para elegir una nueva contraseña. Vence en ${p.expiresMinutes} minutos.`,
              'Si no lo pediste, ignora este correo.',
            ],
            link: { href: p.link, label: 'Restablecer contraseña' },
          };
    }
    case 'password_changed':
      return l === 'en'
        ? {
            subject: 'Your password was changed',
            lines: [
              `Hello ${job.params.name},`,
              'Your password was just changed and your other sessions were closed.',
              'If it was not you, contact support immediately.',
            ],
          }
        : {
            subject: 'Tu contraseña cambió',
            lines: [
              `Hola ${job.params.name}:`,
              'Tu contraseña acaba de cambiar y se cerraron tus otras sesiones.',
              'Si no fuiste tú, contacta a soporte de inmediato.',
            ],
          };
    case 'mfa_enabled':
      return l === 'en'
        ? {
            subject: 'Two-step verification enabled',
            lines: [
              `Hello ${job.params.name},`,
              'Two-step verification is now enabled on your account.',
              'If it was not you, contact support immediately.',
            ],
          }
        : {
            subject: 'Verificación en dos pasos activada',
            lines: [
              `Hola ${job.params.name}:`,
              'Se activó la verificación en dos pasos en tu cuenta.',
              'Si no fuiste tú, contacta a soporte de inmediato.',
            ],
          };
    case 'mfa_disabled':
      return l === 'en'
        ? {
            subject: 'Two-step verification disabled',
            lines: [
              `Hello ${job.params.name},`,
              'Two-step verification was disabled on your account.',
              'If it was not you, contact support immediately.',
            ],
          }
        : {
            subject: 'Verificación en dos pasos desactivada',
            lines: [
              `Hola ${job.params.name}:`,
              'Se desactivó la verificación en dos pasos en tu cuenta.',
              'Si no fuiste tú, contacta a soporte de inmediato.',
            ],
          };
    case 'new_device_login': {
      const p = job.params;
      return l === 'en'
        ? {
            subject: 'New sign-in to your account',
            lines: [
              `Hello ${p.name},`,
              `We detected a sign-in from a new device on ${p.when} (IP ${p.ip}).`,
              `Device: ${p.userAgent}`,
              'If it was not you, change your password and contact support.',
            ],
          }
        : {
            subject: 'Nuevo inicio de sesión en tu cuenta',
            lines: [
              `Hola ${p.name}:`,
              `Detectamos un inicio de sesión desde un dispositivo nuevo el ${p.when} (IP ${p.ip}).`,
              `Dispositivo: ${p.userAgent}`,
              'Si no fuiste tú, cambia tu contraseña y contacta a soporte.',
            ],
          };
    }
  }
}

/**
 * Renders plain text and HTML. Every interpolated value goes through
 * escapeHtml (see templates.test.ts), so the template strings below are safe.
 */
export function render(job: MailJob): RenderedMail {
  const b = bodyFor(job, lang(job.locale));
  const text = [...b.lines, ...(b.link ? ['', `${b.link.label}: ${b.link.href}`] : [])].join('\n');
  // nosemgrep: javascript.lang.security.html-in-template-string.html-in-template-string -- values escaped
  const paragraphs = b.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n');
  const button = b.link
    ? // nosemgrep: javascript.lang.security.html-in-template-string.html-in-template-string -- values escaped
      `<p><a href="${escapeHtml(b.link.href)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:6px">${escapeHtml(b.link.label)}</a></p>`
    : '';
  // nosemgrep: javascript.lang.security.html-in-template-string.html-in-template-string -- values escaped
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111">${paragraphs}${button}</body></html>`;
  return { subject: b.subject, text, html };
}
