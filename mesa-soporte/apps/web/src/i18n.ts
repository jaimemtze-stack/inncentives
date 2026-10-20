import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { cfgEn, cfgEs } from './locales/configForms';
import { usersEn, usersEs } from './locales/users';
import { ticketsEn, ticketsEs } from './locales/tickets';

const es = {
  app: {
    portal: 'Portal de clientes',
    agent: 'Mesa de soporte — Agentes',
    name: 'Soporte Inncentives',
  },
  common: {
    save: 'Guardar',
    cancel: 'Cancelar',
    loading: 'Cargando…',
    email: 'Correo electrónico',
    password: 'Contraseña',
    name: 'Nombre',
    back: 'Volver',
    language: 'Idioma',
    logout: 'Cerrar sesión',
    account: 'Mi cuenta',
    home: 'Inicio',
  },
  login: { title: 'Iniciar sesión', submit: 'Entrar', forgot: '¿Olvidaste tu contraseña?' },
  mfa: {
    title: 'Verificación en dos pasos',
    code: 'Código de 6 dígitos',
    recovery: 'Código de recuperación',
    useRecovery: 'Usar un código de recuperación',
    useCode: 'Usar la app de autenticación',
    submit: 'Verificar',
  },
  enroll: {
    title: 'Configura la verificación en dos pasos',
    intro:
      'Escanea el código con tu app de autenticación (Microsoft Authenticator, Google Authenticator, 1Password…) y escribe el código que muestra.',
    manual: 'O captura esta clave manualmente:',
    confirm: 'Activar',
    codesTitle: 'Guarda tus códigos de recuperación',
    codesHelp:
      'Cada código sirve una sola vez si pierdes tu teléfono. Guárdalos en un lugar seguro; no se volverán a mostrar.',
    done: 'Ya los guardé',
    start: 'Configurar',
  },
  forgot: {
    title: 'Restablecer contraseña',
    submit: 'Enviar enlace',
    sent: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.',
  },
  reset: {
    title: 'Elige una nueva contraseña',
    submit: 'Cambiar contraseña',
    done: 'Tu contraseña cambió. Ya puedes iniciar sesión.',
  },
  invite: {
    title: 'Activa tu cuenta',
    org: 'Organización',
    submit: 'Crear cuenta',
    done: 'Tu cuenta está lista. Ya puedes iniciar sesión.',
  },
  password: {
    hint: 'Mínimo 12 caracteres. Una frase fácil de recordar funciona bien.',
    confirm: 'Confirma la contraseña',
    mismatch: 'Las contraseñas no coinciden.',
    current: 'Contraseña actual',
    new: 'Nueva contraseña',
    change: 'Cambiar contraseña',
    changed: 'Contraseña actualizada. Se cerraron tus otras sesiones.',
  },
  account: {
    title: 'Mi cuenta',
    sessions: 'Sesiones activas',
    current: 'Esta sesión',
    revoke: 'Cerrar',
    revokeOthers: 'Cerrar las demás sesiones',
    mfa: 'Verificación en dos pasos',
    mfaOn: 'Activada',
    mfaOff: 'Desactivada',
    mfaRecommend: 'Te recomendamos activarla para proteger tu cuenta.',
    regenerate: 'Generar nuevos códigos de recuperación',
    reauth: 'Confirma tu contraseña para continuar',
    confirm: 'Confirmar',
    lastSeen: 'Última actividad',
  },
  admin: {
    organizations: 'Organizaciones',
    newOrg: 'Nueva organización',
    domains: 'Dominios (separados por coma)',
    create: 'Crear',
    internal: 'Interna',
    integrations: 'Integraciones',
    tenantKey: 'Clave de Inncentives de {{name}}',
    tenantKeyHint: 'clave-inncentives',
    aiEnabled: 'IA',
    invite: 'Invitar usuario',
    role: 'Rol',
    organization: 'Organización',
    sendInvite: 'Enviar invitación',
    invited: 'Invitación enviada a {{email}}.',
    users: 'Usuarios',
    audit: 'Bitácora de auditoría',
    verify: 'Verificar integridad',
    chainOk: 'Integridad verificada: {{n}} registros sin alteraciones.',
    roles: { ADMIN: 'Administrador', AGENT: 'Agente', CUSTOMER: 'Cliente' },
    when: 'Fecha',
    action: 'Acción',
    actor: 'Usuario',
    ip: 'IP',
  },
  portal: {
    welcome: 'Bienvenido(a), {{name}}',
    soon: 'Aquí podrás levantar y dar seguimiento a tus tickets de soporte.',
  },
  agent: { welcome: 'Hola, {{name}}', soon: 'Las vistas de tickets llegan en la fase 1.' },
  errors: {
    invalid_credentials: 'Correo o contraseña incorrectos.',
    rate_limited: 'Demasiados intentos. Intenta de nuevo en {{s}} segundos.',
    mfa_invalid: 'Código incorrecto.',
    token_invalid: 'El enlace no es válido o ya venció.',
    password_breached: 'Esta contraseña aparece en filtraciones conocidas. Elige otra.',
    validation_failed: 'Revisa los datos capturados.',
    forbidden: 'No tienes permiso para esta acción.',
    generic: 'Ocurrió un error. Intenta de nuevo.',
    conflict: 'Ya existe un registro con esos datos.',
    not_found: 'No encontrado.',
    unauthenticated: 'Tu sesión terminó. Inicia sesión de nuevo.',
  },
};

const en: typeof es = {
  app: { portal: 'Customer portal', agent: 'Support desk — Agents', name: 'Inncentives Support' },
  common: {
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading…',
    email: 'Email',
    password: 'Password',
    name: 'Name',
    back: 'Back',
    language: 'Language',
    logout: 'Sign out',
    account: 'My account',
    home: 'Home',
  },
  login: { title: 'Sign in', submit: 'Sign in', forgot: 'Forgot your password?' },
  mfa: {
    title: 'Two-step verification',
    code: '6-digit code',
    recovery: 'Recovery code',
    useRecovery: 'Use a recovery code',
    useCode: 'Use the authenticator app',
    submit: 'Verify',
  },
  enroll: {
    title: 'Set up two-step verification',
    intro:
      'Scan the code with your authenticator app (Microsoft Authenticator, Google Authenticator, 1Password…) and type the code it shows.',
    manual: 'Or enter this key manually:',
    confirm: 'Enable',
    codesTitle: 'Save your recovery codes',
    codesHelp:
      'Each code works once if you lose your phone. Store them somewhere safe; they will not be shown again.',
    done: 'I saved them',
    start: 'Set up',
  },
  forgot: {
    title: 'Reset password',
    submit: 'Send link',
    sent: 'If the email is registered, you will receive a link to reset your password.',
  },
  reset: {
    title: 'Choose a new password',
    submit: 'Change password',
    done: 'Your password was changed. You can sign in now.',
  },
  invite: {
    title: 'Activate your account',
    org: 'Organization',
    submit: 'Create account',
    done: 'Your account is ready. You can sign in now.',
  },
  password: {
    hint: 'At least 12 characters. An easy-to-remember phrase works well.',
    confirm: 'Confirm password',
    mismatch: 'Passwords do not match.',
    current: 'Current password',
    new: 'New password',
    change: 'Change password',
    changed: 'Password updated. Your other sessions were closed.',
  },
  account: {
    title: 'My account',
    sessions: 'Active sessions',
    current: 'This session',
    revoke: 'Close',
    revokeOthers: 'Close other sessions',
    mfa: 'Two-step verification',
    mfaOn: 'Enabled',
    mfaOff: 'Disabled',
    mfaRecommend: 'We recommend enabling it to protect your account.',
    regenerate: 'Generate new recovery codes',
    reauth: 'Confirm your password to continue',
    confirm: 'Confirm',
    lastSeen: 'Last activity',
  },
  admin: {
    organizations: 'Organizations',
    newOrg: 'New organization',
    domains: 'Domains (comma separated)',
    create: 'Create',
    internal: 'Internal',
    integrations: 'Integrations',
    tenantKey: 'Inncentives key of {{name}}',
    tenantKeyHint: 'inncentives-key',
    aiEnabled: 'AI',
    invite: 'Invite user',
    role: 'Role',
    organization: 'Organization',
    sendInvite: 'Send invitation',
    invited: 'Invitation sent to {{email}}.',
    users: 'Users',
    audit: 'Audit log',
    verify: 'Verify integrity',
    chainOk: 'Integrity verified: {{n}} records unaltered.',
    roles: { ADMIN: 'Administrator', AGENT: 'Agent', CUSTOMER: 'Customer' },
    when: 'Date',
    action: 'Action',
    actor: 'User',
    ip: 'IP',
  },
  portal: {
    welcome: 'Welcome, {{name}}',
    soon: 'Here you will open and follow your support tickets.',
  },
  agent: { welcome: 'Hi, {{name}}', soon: 'Ticket views arrive in phase 1.' },
  errors: {
    invalid_credentials: 'Incorrect email or password.',
    rate_limited: 'Too many attempts. Try again in {{s}} seconds.',
    mfa_invalid: 'Incorrect code.',
    token_invalid: 'The link is invalid or has expired.',
    password_breached: 'This password appears in known breaches. Choose another one.',
    validation_failed: 'Check the data you entered.',
    forbidden: 'You are not allowed to do this.',
    generic: 'Something went wrong. Try again.',
    conflict: 'A record with that data already exists.',
    not_found: 'Not found.',
    unauthenticated: 'Your session ended. Sign in again.',
  },
};

const saved = (() => {
  try {
    return localStorage.getItem('lang');
  } catch {
    return null;
  }
})();

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: { ...es, ...ticketsEs, ...cfgEs, ...usersEs } },
    en: { translation: { ...en, ...ticketsEn, ...cfgEn, ...usersEn } },
  },
  lng: saved ?? (navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es'),
  fallbackLng: 'es',
  interpolation: { escapeValue: false }, // React already escapes
});

export function setLanguage(lng: 'es' | 'en'): void {
  void i18n.changeLanguage(lng);
  document.documentElement.lang = lng === 'es' ? 'es-MX' : 'en';
  try {
    localStorage.setItem('lang', lng);
  } catch {
    /* ignore */
  }
}

export default i18n;
