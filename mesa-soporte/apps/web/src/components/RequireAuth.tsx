import { Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../session';

/** Sends the user to the step their session needs (login, MFA, enrollment). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const me = useMe();
  if (me.isLoading) return <p>{t('common.loading')}</p>;
  if (!me.data) return <Navigate to="/entrar" />;
  if (me.data.state === 'mfa_required') return <Navigate to="/verificar" />;
  if (me.data.state === 'mfa_enrollment_required') return <Navigate to="/configurar-mfa" />;
  return <>{children}</>;
}
