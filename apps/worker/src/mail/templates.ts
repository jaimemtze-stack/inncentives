import { escapeHtml } from '@inn/shared';

/**
 * Transactional e-mail templates (code-defined, not user-editable). Every variable is
 * HTML-escaped; links are restricted to https/http URLs from configuration.
 */
export type Locale = 'es-MX' | 'en';
export type TemplateName =
  'invitation' | 'password_reset' | 'password_changed' | 'mfa_changed' | 'new_device_login';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

type Vars = Record<string, string>;
type Def = {
  subject: string;
  lines: (v: Vars) => string[];
  link?: (v: Vars) => string | undefined;
  cta?: string;
};

const T: Record<Locale, Record<TemplateName, Def>> = {
  'es-MX': {
    invitation: {
      subject: 'Invitación a Soporte Inncentives',
      lines: (v) => [
        `Hola ${v.firstname ?? ''},`,
        'Se creó una cuenta para ti en la mesa de soporte de Inncentives.',
        `El enlace es de un solo uso y caduca en ${v.hours ?? '72'} horas.`,
      ],
      link: (v) => v.link,
      cta: 'Activar mi cuenta',
    },
    password_reset: {
      subject: 'Restablecer tu contraseña',
      lines: (v) => [
        'Recibimos una solicitud para restablecer tu contraseña.',
        `El enlace es de un solo uso y caduca en ${v.minutes ?? '30'} minutos.`,
        'Si no la solicitaste, ignora este correo.',
      ],
      link: (v) => v.link,
      cta: 'Restablecer contraseña',
    },
    password_changed: {
      subject: 'Tu contraseña cambió',
      lines: () => [
        'La contraseña de tu cuenta se cambió y se cerraron tus otras sesiones.',
        'Si no fuiste tú, contacta a soporte de inmediato.',
      ],
    },
    mfa_changed: {
      subject: 'Cambio en tu verificación en dos pasos',
      lines: (v) => [
        v.change === 'enabled'
          ? 'Se activó la verificación en dos pasos en tu cuenta.'
          : 'Se desactivó la verificación en dos pasos en tu cuenta.',
        'Si no fuiste tú, contacta a soporte de inmediato.',
      ],
    },
    new_device_login: {
      subject: 'Nuevo inicio de sesión en tu cuenta',
      lines: (v) => [
        `Detectamos un inicio de sesión desde un dispositivo nuevo (${v.userAgent ?? 'desconocido'}) el ${v.date ?? ''} (UTC).`,
        'Si no fuiste tú, cambia tu contraseña y revisa tus sesiones activas.',
      ],
    },
  },
  en: {
    invitation: {
      subject: 'Invitation to Inncentives Support',
      lines: (v) => [
        `Hello ${v.firstname ?? ''},`,
        'An account was created for you on the Inncentives support desk.',
        `The link can be used once and expires in ${v.hours ?? '72'} hours.`,
      ],
      link: (v) => v.link,
      cta: 'Activate my account',
    },
    password_reset: {
      subject: 'Reset your password',
      lines: (v) => [
        'We received a request to reset your password.',
        `The link can be used once and expires in ${v.minutes ?? '30'} minutes.`,
        'If you did not request it, ignore this e-mail.',
      ],
      link: (v) => v.link,
      cta: 'Reset password',
    },
    password_changed: {
      subject: 'Your password changed',
      lines: () => [
        'Your account password was changed and your other sessions were signed out.',
        'If this was not you, contact support immediately.',
      ],
    },
    mfa_changed: {
      subject: 'Two-step verification changed',
      lines: (v) => [
        v.change === 'enabled'
          ? 'Two-step verification was enabled on your account.'
          : 'Two-step verification was disabled on your account.',
        'If this was not you, contact support immediately.',
      ],
    },
    new_device_login: {
      subject: 'New sign-in to your account',
      lines: (v) => [
        `We noticed a sign-in from a new device (${v.userAgent ?? 'unknown'}) on ${v.date ?? ''} (UTC).`,
        'If this was not you, change your password and review your active sessions.',
      ],
    },
  },
};

const SAFE_LINK = /^https?:\/\/[^\s"'<>]+$/;

export function renderMail(
  name: TemplateName,
  locale: string,
  vars: Vars,
  productName = 'Soporte Inncentives',
): RenderedMail {
  const loc: Locale = locale === 'en' ? 'en' : 'es-MX';
  const def = T[loc][name];
  const lines = def.lines(vars);
  const link = def.link?.(vars);
  if (link !== undefined && !SAFE_LINK.test(link)) throw new Error('Unsafe link in mail template');
  const html = [
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">`,
    ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(def.cta ?? link)}</a></p>` : '',
    `<p style="color:#6b7280;font-size:12px">${escapeHtml(productName)}</p>`,
    `</div>`,
  ].join('');
  const text = [...lines, ...(link ? ['', link] : []), '', productName].join('\n');
  return { subject: def.subject.replace(/[\r\n]/g, ' '), html, text };
}
