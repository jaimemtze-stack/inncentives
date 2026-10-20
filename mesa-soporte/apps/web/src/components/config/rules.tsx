import {
  ConditionFields,
  CURRENT_USER,
  EventOperators,
  OperatorsByType,
  SettableTicketFields,
  TemplateVariables,
  TicketStates,
  WorkflowFieldNames,
  type ConditionUsage,
  type FieldDef,
  type FieldType,
} from '@mesa/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api';
import {
  MultiCheck,
  NumIn,
  RefSelect,
  Rows,
  SelectIn,
  TextArea,
  TextIn,
  ListIn,
  numOrNull,
  rec,
  recs,
  str,
  useOptions,
  useRefOptions,
  type Options,
  type Rec,
  type RefSource,
} from './fields';

interface CustomAttr {
  name: string;
  label: string;
  labelEn: string | null;
  dataType: string;
  options: Array<{ value: string; label: string; labelEn?: string }>;
}

/** Active custom ticket fields (object attributes of the ticket). */
function useTicketAttributes(): CustomAttr[] {
  const q = useQuery({
    queryKey: ['config', 'object-attributes'],
    queryFn: () => api<Rec[]>('GET', '/admin/config/object-attributes'),
  });
  return (q.data ?? [])
    .filter((a) => a.object === 'ticket' && a.active !== false)
    .map((a) => ({
      name: str(a.name),
      label: str(a.label),
      labelEn: a.labelEn ? str(a.labelEn) : null,
      dataType: str(a.dataType),
      options: recs(a.options).map((o) => ({
        value: str(o.value),
        label: str(o.label),
        labelEn: o.labelEn ? str(o.labelEn) : undefined,
      })),
    }));
}

function useEn(): boolean {
  return useTranslation().i18n.language.startsWith('en');
}

// ---------------------------------------------------------------- conditions

const ENUM_LABELS: Record<string, string> = {
  'ticket.state': 'states',
  'ticket.channel': 'cfg.channel',
  'article.type': 'cfg.articleType',
  'article.sender': 'cfg.sender',
};

const ID_SOURCES: Record<string, RefSource> = {
  'ticket.priority_id': 'priorities',
  'ticket.group_id': 'groups',
  'ticket.owner_id': 'staff',
  'ticket.mentioned_user_id': 'staff',
  'ticket.customer_id': 'users',
  'ticket.organization_id': 'organizations',
  'organization.support_plan_id': 'support-plans',
};

const LIST_OPS = ['in', 'not_in', 'contains_all', 'contains_one', 'contains_none'];
const NO_VALUE_OPS = ['is_set', 'not_set', 'changed'];
const RELATIVE_OPS = ['before_relative', 'after_relative'];
const CUSTOM_DEF: FieldDef = { type: 'string', queryable: true, label: { es: '', en: '' } };

function fieldDef(field: string): FieldDef | undefined {
  if (field.startsWith('ticket.custom.')) return CUSTOM_DEF;
  return (ConditionFields as Record<string, FieldDef>)[field];
}

function operatorsFor(def: FieldDef, usage: ConditionUsage): string[] {
  const ops = [...OperatorsByType[def.type]];
  if (usage.event && def.trackable) ops.push(...EventOperators);
  return ops;
}

function defaultValue(type: FieldType, operator: string): unknown {
  if (NO_VALUE_OPS.includes(operator)) return undefined;
  if (RELATIVE_OPS.includes(operator)) return { minutes: -60 };
  if (LIST_OPS.includes(operator)) return [];
  if (type === 'boolean') return true;
  if (type === 'number') return 0;
  return '';
}

/** Editor for a rule condition tree: groups (all/any) of field–operator–value rows. */
export function ConditionEditor(props: {
  value: unknown;
  onChange: (v: Rec) => void;
  usage: ConditionUsage;
}) {
  const node = rec(props.value);
  // The root is always a group; a lone condition is wrapped.
  const root = 'op' in node ? node : { op: 'and', conditions: 'field' in node ? [node] : [] };
  return <GroupEditor node={root} onChange={props.onChange} usage={props.usage} depth={0} />;
}

function GroupEditor(props: {
  node: Rec;
  onChange: (v: Rec) => void;
  usage: ConditionUsage;
  depth: number;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const children = recs(props.node.conditions);
  const set = (conditions: Rec[]) => props.onChange({ ...props.node, conditions });
  return (
    <div
      className={`space-y-2 ${props.depth ? 'rounded border border-dashed border-ink-300 p-2 dark:border-ink-600' : ''}`}
    >
      <div className="flex items-center gap-2">
        <select
          aria-label={t('cfg.f.conditions')}
          className="input w-auto"
          value={props.node.op === 'or' ? 'or' : 'and'}
          onChange={(e) => props.onChange({ ...props.node, op: e.target.value })}
        >
          <option value="and">{t('cfg.cond.all')}</option>
          <option value="or">{t('cfg.cond.any')}</option>
        </select>
        {props.onRemove && (
          <button type="button" className="text-sm text-red-700 underline" onClick={props.onRemove}>
            {t('cfg.remove')}
          </button>
        )}
      </div>
      {children.length === 0 && props.depth === 0 && (
        <p className="text-xs text-ink-500">{t('cfg.cond.empty')}</p>
      )}
      {children.map((c, i) => {
        const update = (v: Rec) => set(children.map((x, j) => (j === i ? v : x)));
        const remove = () => set(children.filter((_, j) => j !== i));
        return 'op' in c ? (
          <GroupEditor
            key={i}
            node={c}
            onChange={update}
            usage={props.usage}
            depth={props.depth + 1}
            onRemove={remove}
          />
        ) : (
          <LeafEditor key={i} node={c} onChange={update} usage={props.usage} onRemove={remove} />
        );
      })}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            set([...children, { field: 'ticket.state', operator: 'is', value: 'new' }])
          }
        >
          {t('cfg.cond.addCondition')}
        </button>
        {props.depth < 3 && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => set([...children, { op: 'or', conditions: [] }])}
          >
            {t('cfg.cond.addGroup')}
          </button>
        )}
      </div>
    </div>
  );
}

function LeafEditor(props: {
  node: Rec;
  onChange: (v: Rec) => void;
  usage: ConditionUsage;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const en = useEn();
  const attrs = useTicketAttributes();
  const field = str(props.node.field);
  const operator = str(props.node.operator);
  const def = fieldDef(field);

  const fieldOptions: Array<readonly [string, string]> = Object.entries(
    ConditionFields as Record<string, FieldDef>,
  )
    .filter(([, d]) => !props.usage.queryable || d.queryable)
    .filter(([k]) => props.usage.event || !k.startsWith('article.'))
    .map(([k, d]) => [k, en ? d.label.en : d.label.es] as const);
  for (const a of attrs)
    fieldOptions.push([`ticket.custom.${a.name}`, (en && a.labelEn) || a.label] as const);

  const ops = def ? operatorsFor(def, props.usage) : [];
  const opOptions = ops.map((o) => [o, t(`cfg.op.${o}`)] as const);

  function setField(f: string | null) {
    const d = f ? fieldDef(f) : undefined;
    if (!f || !d) return;
    const op = operatorsFor(d, props.usage)[0]!;
    props.onChange({ field: f, operator: op, value: defaultValue(d.type, op) });
  }
  function setOperator(op: string | null) {
    if (!op || !def) return;
    const keep =
      LIST_OPS.includes(op) === LIST_OPS.includes(operator) &&
      RELATIVE_OPS.includes(op) === RELATIVE_OPS.includes(operator) &&
      !NO_VALUE_OPS.includes(operator);
    const value = keep ? props.node.value : defaultValue(def.type, op);
    const next: Rec = { field, operator: op };
    if (value !== undefined) next.value = value;
    props.onChange(next);
  }

  return (
    <div className="grid items-end gap-2 rounded border border-ink-200 p-2 sm:grid-cols-[1fr_1fr_1.5fr_auto] dark:border-ink-700">
      <SelectIn label={t('cfg.f.field')} value={field} onChange={setField} options={fieldOptions} />
      <SelectIn
        label={t('cfg.f.operator')}
        value={operator}
        onChange={setOperator}
        options={opOptions}
      />
      <div>
        {def && !NO_VALUE_OPS.includes(operator) && (
          <ValueEditor
            field={field}
            type={def.type}
            values={def.values}
            operator={operator}
            value={props.node.value}
            attr={attrs.find((a) => `ticket.custom.${a.name}` === field)}
            onChange={(value) => props.onChange({ field, operator, value })}
          />
        )}
      </div>
      <button
        type="button"
        className="mb-2 text-sm text-red-700 underline"
        onClick={props.onRemove}
      >
        {t('cfg.remove')}
      </button>
    </div>
  );
}

/** "2026-10-20T16:00:00.000Z" ↔ the value of a datetime-local input. */
function toLocalInput(v: unknown): string {
  const d = new Date(str(v));
  if (!str(v) || Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ValueEditor(props: {
  field: string;
  type: FieldType;
  values?: readonly string[];
  operator: string;
  value: unknown;
  attr?: CustomAttr;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const en = useEn();
  const label = t('cfg.f.value');
  const list = LIST_OPS.includes(props.operator);
  const enumLabels = useOptions(ENUM_LABELS[props.field] ?? 'cfg.none', props.values ?? []);

  if (RELATIVE_OPS.includes(props.operator)) {
    return (
      <NumIn
        label={t('cfg.f.minutes')}
        value={numOrNull(rec(props.value).minutes)}
        onChange={(n) => props.onChange({ minutes: n ?? 0 })}
        hint={t('cfg.cond.relativeHint')}
      />
    );
  }
  if (props.attr && ['select', 'multiselect'].includes(props.attr.dataType)) {
    const options = props.attr.options.map((o) => [o.value, (en && o.labelEn) || o.label] as const);
    return (
      <SelectIn label={label} value={props.value} onChange={props.onChange} options={options} />
    );
  }
  switch (props.type) {
    case 'enum':
      return list ? (
        <MultiCheck
          label={label}
          value={props.value}
          onChange={props.onChange}
          options={enumLabels}
        />
      ) : (
        <SelectIn
          label={label}
          value={props.value}
          onChange={props.onChange}
          options={enumLabels}
        />
      );
    case 'id':
      return (
        <IdValue
          source={ID_SOURCES[props.field] ?? 'users'}
          list={list}
          value={props.value}
          onChange={props.onChange}
        />
      );
    case 'tags':
      return <ListIn label={label} value={props.value} onChange={props.onChange} />;
    case 'date':
      return (
        <TextIn
          label={label}
          type="datetime-local"
          value={toLocalInput(props.value)}
          onChange={(v) => props.onChange(v ? new Date(v).toISOString() : '')}
        />
      );
    case 'boolean':
      return (
        <SelectIn
          label={label}
          value={props.value === false ? 'false' : 'true'}
          onChange={(v) => props.onChange(v === 'true')}
          options={[
            ['true', t('cfg.yes')],
            ['false', t('cfg.no')],
          ]}
        />
      );
    case 'number':
      return <NumIn label={label} value={props.value} onChange={(n) => props.onChange(n ?? 0)} />;
    default:
      return <TextIn label={label} value={props.value} onChange={props.onChange} />;
  }
}

/** Record picker for id fields; agents and customers also offer "current user". */
function IdValue(props: {
  source: RefSource;
  list: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { t } = useTranslation();
  const base = useRefOptions(props.source);
  const options: Options =
    props.source === 'staff' || props.source === 'users'
      ? [[CURRENT_USER, t('cfg.cond.currentUser')], ...base]
      : base;
  const label = t('cfg.f.value');
  return props.list ? (
    <MultiCheck label={label} value={props.value} onChange={props.onChange} options={options} />
  ) : (
    <SelectIn label={label} value={props.value} onChange={props.onChange} options={options} />
  );
}

// ------------------------------------------------------------------- actions

const ACTION_TYPES = [
  'set',
  'set_custom',
  'add_tags',
  'remove_tags',
  'notify',
  'add_note',
  'webhook',
  'reply_customer',
] as const;

function newAction(type: string): Rec {
  switch (type) {
    case 'set':
      return { type, field: 'state', value: 'open' };
    case 'set_custom':
      return { type, key: '', value: '' };
    case 'add_tags':
    case 'remove_tags':
      return { type, tags: [] };
    case 'notify':
      return { type, recipients: ['owner'], subject: '', body: '' };
    case 'webhook':
      return { type, webhookId: '' };
    case 'reply_customer':
      return { type, subject: '', body: '' };
    default:
      return { type: 'add_note', body: '' };
  }
}

/** Ordered list of rule actions (triggers, schedulers, macros). */
export function ActionsEditor(props: { value: unknown; onChange: (v: Rec[]) => void }) {
  const { t } = useTranslation();
  const types = useOptions('cfg.action', ACTION_TYPES);
  return (
    <Rows
      label={t('cfg.f.actions')}
      items={recs(props.value)}
      onChange={props.onChange}
      make={() => newAction('set')}
      max={20}
      render={(a, set) => (
        <div className="space-y-2">
          <SelectIn
            label={t('cfg.f.kind')}
            value={a.type}
            onChange={(v) => set(newAction(v ?? 'set'))}
            options={types}
          />
          <ActionFields action={a} onChange={set} />
        </div>
      )}
    />
  );
}

function ActionFields(props: { action: Rec; onChange: (v: Rec) => void }) {
  const { t } = useTranslation();
  const a = props.action;
  const set = (patch: Rec) => props.onChange({ ...a, ...patch });
  const vars = t('cfg.variablesHint', {
    vars: TemplateVariables.map((v) => `{{${v}}}`).join(' '),
  });
  switch (a.type) {
    case 'set':
      return <SetFieldAction action={a} onChange={props.onChange} />;
    case 'set_custom':
      return <SetCustomAction action={a} onChange={props.onChange} />;
    case 'add_tags':
    case 'remove_tags':
      return <ListIn label={t('cfg.f.tags')} value={a.tags} onChange={(tags) => set({ tags })} />;
    case 'notify':
      return (
        <>
          <Recipients value={a.recipients} onChange={(recipients) => set({ recipients })} />
          <TextIn
            label={t('cfg.f.subject')}
            value={a.subject}
            onChange={(subject) => set({ subject })}
          />
          <TextArea
            label={t('cfg.f.body')}
            value={a.body}
            onChange={(body) => set({ body })}
            hint={vars}
          />
        </>
      );
    case 'add_note':
      return (
        <TextArea
          label={t('cfg.f.body')}
          value={a.body}
          onChange={(body) => set({ body })}
          hint={vars}
        />
      );
    case 'webhook':
      return (
        <RefSelect
          label={t('cfg.f.webhook')}
          source="webhooks"
          value={a.webhookId}
          onChange={(webhookId) => set({ webhookId: webhookId ?? '' })}
        />
      );
    case 'reply_customer':
      return (
        <>
          <TextIn
            label={t('cfg.f.subject')}
            value={a.subject}
            onChange={(subject) => set({ subject })}
          />
          <TextArea
            label={t('cfg.f.body')}
            value={a.body}
            onChange={(body) => set({ body })}
            hint={vars}
          />
        </>
      );
    default:
      return null;
  }
}

function SetFieldAction(props: { action: Rec; onChange: (v: Rec) => void }) {
  const { t } = useTranslation();
  const fields = useOptions('cfg.settable', SettableTicketFields);
  const states = useOptions('states', TicketStates);
  const a = props.action;
  const field = str(a.field);
  const setValue = (value: unknown) => props.onChange({ ...a, value });
  const label = t('cfg.f.value');
  const initial: Record<string, unknown> = { state: 'open', pending_until_minutes: 1440 };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <SelectIn
        label={t('cfg.f.field')}
        value={field}
        options={fields}
        onChange={(f) => props.onChange({ ...a, field: f, value: initial[f ?? ''] ?? null })}
      />
      {field === 'state' && (
        <SelectIn label={label} value={a.value} onChange={setValue} options={states} />
      )}
      {field === 'priority_id' && (
        <RefSelect label={label} source="priorities" value={a.value} onChange={setValue} />
      )}
      {field === 'group_id' && (
        <RefSelect label={label} source="groups" value={a.value} onChange={setValue} />
      )}
      {field === 'owner_id' && (
        <RefSelect label={label} source="staff" value={a.value} onChange={setValue} empty />
      )}
      {field === 'pending_until_minutes' && (
        <NumIn
          label={t('cfg.f.minutes')}
          value={a.value}
          min={1}
          onChange={setValue}
          hint={t('cfg.minutesHint')}
        />
      )}
    </div>
  );
}

function SetCustomAction(props: { action: Rec; onChange: (v: Rec) => void }) {
  const { t } = useTranslation();
  const en = useEn();
  const attrs = useTicketAttributes();
  const a = props.action;
  const attr = attrs.find((x) => x.name === a.key);
  const setValue = (value: unknown) => props.onChange({ ...a, value });
  const label = t('cfg.f.value');
  let editor = <TextIn label={label} value={a.value} onChange={setValue} />;
  if (attr?.dataType === 'boolean')
    editor = (
      <SelectIn
        label={label}
        value={a.value === true ? 'true' : 'false'}
        onChange={(v) => setValue(v === 'true')}
        options={[
          ['true', t('cfg.yes')],
          ['false', t('cfg.no')],
        ]}
      />
    );
  else if (attr?.dataType === 'integer')
    editor = <NumIn label={label} value={a.value} onChange={setValue} />;
  else if (attr && ['select', 'multiselect'].includes(attr.dataType))
    editor = (
      <SelectIn
        label={label}
        value={a.value}
        onChange={setValue}
        empty
        options={attr.options.map((o) => [o.value, (en && o.labelEn) || o.label] as const)}
      />
    );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <SelectIn
        label={t('cfg.f.key')}
        value={a.key}
        onChange={(key) => props.onChange({ ...a, key: key ?? '', value: '' })}
        options={attrs.map((x) => [x.name, (en && x.labelEn) || x.label] as const)}
      />
      {editor}
    </div>
  );
}

const FIXED_RECIPIENTS = ['owner', 'group', 'subscribers', 'customer'] as const;

function Recipients(props: { value: unknown; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const fixed = useOptions('cfg.recipient', FIXED_RECIPIENTS);
  const staff = useRefOptions('staff');
  const options: Options = [...fixed, ...staff.map(([id, l]) => [`user:${id}`, l] as const)];
  return (
    <MultiCheck
      label={t('cfg.f.recipients')}
      value={props.value}
      onChange={props.onChange}
      options={options}
    />
  );
}

// ------------------------------------------------------------ core workflows

type Effect = Rec;

/** Effects of a core workflow, one row per form field. */
export function WorkflowActionsEditor(props: {
  value: unknown;
  onChange: (v: Record<string, Effect>) => void;
}) {
  const { t } = useTranslation();
  const en = useEn();
  const attrs = useTicketAttributes();
  const [rows, setRows] = useState<Array<[string, Effect]>>(() =>
    Object.entries(rec(props.value)).map(([k, v]) => [k, rec(v)]),
  );
  const fieldOptions: Options = [
    ...WorkflowFieldNames.map((f) => [f, t(`cfg.wf.${f}`)] as const),
    ...attrs.map((a) => [`custom.${a.name}`, (en && a.labelEn) || a.label] as const),
  ];
  function update(next: Array<[string, Effect]>) {
    setRows(next);
    props.onChange(Object.fromEntries(next.filter(([k]) => k)));
  }
  const tri = (label: string, effect: Effect, key: string, set: (e: Effect) => void) => (
    <SelectIn
      label={label}
      value={effect[key] === undefined ? '' : String(effect[key])}
      empty
      options={[
        ['true', t('cfg.yes')],
        ['false', t('cfg.no')],
      ]}
      onChange={(v) => {
        const { [key]: _drop, ...rest } = effect;
        set(v === null ? rest : { ...rest, [key]: v === 'true' });
      }}
    />
  );
  return (
    <Rows
      label={t('cfg.f.fieldEffects')}
      items={rows}
      onChange={update}
      make={(): [string, Effect] => ['', { mandatory: true }]}
      max={40}
      render={([field, effect], set) => {
        const setEffect = (e: Effect) => set([field, e]);
        const optional = (key: string, v: unknown) => {
          const { [key]: _drop, ...rest } = effect;
          setEffect(v === undefined ? rest : { ...rest, [key]: v });
        };
        return (
          <div className="space-y-2">
            <SelectIn
              label={t('cfg.f.field')}
              value={field}
              options={fieldOptions}
              onChange={(f) => set([f ?? '', effect])}
            />
            <div className="grid gap-2 sm:grid-cols-3">
              {tri(t('cfg.f.visible'), effect, 'visible', setEffect)}
              {tri(t('cfg.f.mandatory'), effect, 'mandatory', setEffect)}
              {tri(t('cfg.f.readonly'), effect, 'readonly', setEffect)}
            </div>
            <ListIn
              label={t('cfg.f.allowed')}
              value={effect.options}
              onChange={(v) => optional('options', v.length ? v : undefined)}
            />
            <TextIn
              label={t('cfg.f.prefill')}
              value={effect.value}
              onChange={(v) => optional('value', v === '' ? undefined : v)}
            />
          </div>
        );
      }}
    />
  );
}
