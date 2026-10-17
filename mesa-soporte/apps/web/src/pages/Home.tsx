import { useTranslation } from 'react-i18next';
import { useMe } from '../session';

export function HomePage() {
  const { t } = useTranslation();
  const me = useMe();
  const user = me.data?.user;
  if (!user) return null;
  const isPortal = me.data?.area === 'portal';
  return (
    <div className="card space-y-2">
      <h1 className="text-2xl font-semibold">
        {t(isPortal ? 'portal.welcome' : 'agent.welcome', { name: user.name })}
      </h1>
      <p className="text-slate-600 dark:text-slate-400">
        {t(isPortal ? 'portal.soon' : 'agent.soon')}
      </p>
    </div>
  );
}
