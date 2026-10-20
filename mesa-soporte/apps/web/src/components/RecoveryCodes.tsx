import { useTranslation } from 'react-i18next';

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('enroll.codesTitle')}</h2>
      <p className="text-sm text-plum-600 dark:text-plum-400">{t('enroll.codesHelp')}</p>
      <ul
        className="grid grid-cols-2 gap-2 rounded-md bg-plum-100 p-4 font-mono text-sm dark:bg-plum-800"
        data-testid="recovery-codes"
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <button type="button" className="btn-primary w-full" onClick={onDone}>
        {t('enroll.done')}
      </button>
    </div>
  );
}
