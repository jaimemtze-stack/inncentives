import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { AttachmentPicker, confirmSensitive, CustomFieldInputs } from '../components/Composer';
import { Alert, useErrorText } from '../components/ui';
import { textToHtml, useFormMeta, type Ref } from '../lib/tickets';
import { useMe } from '../session';
import { useKbSearch } from './Kb';

interface Customer extends Ref {
  email: string;
  phone: string | null;
  organization: Ref;
}

export function TicketNewPage() {
  const { t, i18n } = useTranslation();
  const errorText = useErrorText();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const staff = me.data?.area === 'agent';
  const meta = useFormMeta();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [groupId, setGroupId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [type, setType] = useState<'phone' | 'email' | 'note'>('phone');
  const [customerQ, setCustomerQ] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [required, setRequired] = useState<string[]>([]);
  const suggestions = useKbSearch(title, 5);

  const customers = useQuery({
    queryKey: ['lookup', customerQ],
    enabled: staff && customerQ.length >= 2 && !customer,
    queryFn: () => api<Customer[]>('GET', `/lookup/customers?q=${encodeURIComponent(customerQ)}`),
  });

  useEffect(() => {
    if (!groupId && meta.data?.groups?.length)
      setGroupId(meta.data.groups.find((g) => !g.isTriage)?.id ?? meta.data.groups[0]!.id);
  }, [meta.data, groupId]);

  // Core workflows: ask the server which fields the current values make mandatory.
  useEffect(() => {
    const screen = staff ? 'create_agent' : 'create_customer';
    const values = staff
      ? { group_id: groupId || undefined, priority_id: priorityId || undefined }
      : {};
    api<{ fields: Record<string, { mandatory?: boolean }> }>('POST', '/ticket-form/evaluate', {
      screen,
      values: { ...values, custom: customFields },
    })
      .then((r) =>
        setRequired(
          Object.entries(r.fields)
            .filter(([, e]) => e.mandatory)
            .map(([f]) => f),
        ),
      )
      .catch(() => undefined);
  }, [staff, groupId, priorityId, customFields]);

  function applyTemplate(id: string) {
    const tpl = meta.data?.templates?.find((x) => x.id === id);
    if (!tpl) return;
    const f = tpl.fields as {
      title?: string;
      body?: string;
      groupId?: string;
      priorityId?: string;
      customFields?: Record<string, unknown>;
    };
    if (f.title) setTitle(f.title);
    if (f.body) setBody(f.body);
    if (f.groupId) setGroupId(f.groupId);
    if (f.priorityId) setPriorityId(f.priorityId);
    if (f.customFields) setCustomFields({ ...customFields, ...f.customFields });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!staff && !(await confirmSensitive(`${title}\n${body}`, t))) return;
    setBusy(true);
    try {
      const html = textToHtml(body);
      const created = staff
        ? await api<{ id: string; number: string }>('POST', '/tickets', {
            title,
            groupId,
            ...(priorityId ? { priorityId } : {}),
            customerId: customer?.id,
            customFields,
            article: {
              type,
              body: html,
              ...(type === 'phone' ? { callDirection: 'in' } : {}),
              ...(attachmentIds.length ? { attachmentIds } : {}),
            },
          })
        : await api<{ id: string; number: string }>('POST', '/tickets', {
            title,
            body: html,
            customFields,
            ...(attachmentIds.length ? { attachmentIds } : {}),
          });
      await qc.invalidateQueries({ queryKey: ['overviews'] });
      await navigate({ to: '/tickets/$id', params: { id: created.id } });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const notice = meta.data?.privacyNotice?.[i18n.language.startsWith('en') ? 'en' : 'es'];

  return (
    <form onSubmit={submit} className="card mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t('nav.newTicket')}</h1>
      {!staff && notice && <Alert kind="info">{notice}</Alert>}
      {staff && (meta.data?.templates?.length ?? 0) > 0 && (
        <div>
          <label htmlFor="tpl" className="label">
            {t('tickets.template')}
          </label>
          <select
            id="tpl"
            className="input"
            defaultValue=""
            onChange={(e) => applyTemplate(e.target.value)}
          >
            <option value="">—</option>
            {meta.data?.templates?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {staff && (
        <div>
          <label htmlFor="cust" className="label">
            {t('tickets.customerSearch')}
          </label>
          {customer ? (
            <p className="mt-1 text-sm">
              <strong>{customer.name}</strong> · {customer.email} · {customer.organization.name}{' '}
              <button type="button" className="link" onClick={() => setCustomer(null)}>
                ×
              </button>
            </p>
          ) : (
            <>
              <input
                id="cust"
                className="input"
                value={customerQ}
                onChange={(e) => setCustomerQ(e.target.value)}
              />
              <ul className="mt-1 text-sm">
                {customers.data?.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="link" onClick={() => setCustomer(c)}>
                      {c.name} · {c.email} · {c.organization.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div>
        <label htmlFor="title" className="label">
          {t('tickets.title')}
        </label>
        <input
          id="title"
          className="input"
          required
          maxLength={250}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      {staff && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="grp" className="label">
              {t('tickets.group')}
            </label>
            <select
              id="grp"
              className="input"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              {meta.data?.groups?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="prio" className="label">
              {t('tickets.priority')}
            </label>
            <select
              id="prio"
              className="input"
              value={priorityId}
              onChange={(e) => setPriorityId(e.target.value)}
            >
              <option value="">—</option>
              {meta.data?.priorities?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="typ" className="label">
              {t('article.type')}
            </label>
            <select
              id="typ"
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="phone">{t('article.types.phone')}</option>
              <option value="email">{t('article.types.email')}</option>
              <option value="note">{t('article.types.note')}</option>
            </select>
          </div>
        </div>
      )}
      {!!suggestions.data?.length && (
        <div
          className="rounded border border-brand-200 bg-brand-50 p-3 text-sm dark:border-brand-900 dark:bg-brand-950"
          role="status"
        >
          <p className="font-medium">{t('kb.suggestions')}</p>
          <ul className="list-disc pl-5">
            {suggestions.data.map((s) => (
              <li key={s.id}>
                <Link to="/kb/$id" params={{ id: s.id }} className="link" target="_blank">
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <label htmlFor="body" className="label">
          {t('article.body')}
        </label>
        <textarea
          id="body"
          className="input min-h-40"
          required
          maxLength={100_000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {meta.data && meta.data.attributes.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="font-semibold">{t('tickets.customFields')}</legend>
          <CustomFieldInputs
            attributes={meta.data.attributes}
            values={customFields}
            customer={!staff}
            onChange={setCustomFields}
          />
          {required.length > 0 && <p className="text-xs text-ink-600">* {required.join(', ')}</p>}
        </fieldset>
      )}
      <AttachmentPicker onChange={setAttachmentIds} />
      {error && <Alert>{error}</Alert>}
      <button type="submit" className="btn-primary" disabled={busy || (staff && !customer)}>
        {t('tickets.create')}
      </button>
    </form>
  );
}
