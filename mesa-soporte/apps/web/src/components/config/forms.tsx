import {
  GroupAccessLevels,
  ObjectAttributeTypes,
  Permission,
  Roles,
  TicketStates,
  WorkflowScreens,
} from '@mesa/shared';
import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  ListIn,
  MultiCheck,
  NumIn,
  RefMulti,
  RefSelect,
  Rows,
  Section,
  SelectIn,
  TextArea,
  TextIn,
  numOrNull,
  rec,
  recs,
  str,
  strs,
  useOptions,
  type Rec,
} from './fields';
import { ActionsEditor, ConditionEditor, WorkflowActionsEditor } from './rules';

interface FormProps {
  value: Rec;
  onChange: (v: Rec) => void;
  isNew: boolean;
}

/** Binds a key of `value` to a field: {...b('name')}. Empty strings become `empty`. */
function binder(value: Rec, onChange: (v: Rec) => void) {
  return (key: string, empty?: null | 'omit') => ({
    value: value[key],
    onChange: (x: unknown) => {
      if (x === '' || x === null) {
        if (empty === 'omit') {
          const { [key]: _drop, ...rest } = value;
          return onChange(rest);
        }
        if (empty === null) return onChange({ ...value, [key]: null });
      }
      onChange({ ...value, [key]: x });
    },
  });
}

const Grid = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-3 sm:grid-cols-2">{children}</div>
);

function Active({ value, onChange }: Omit<FormProps, 'isNew'>) {
  const { t } = useTranslation();
  return (
    <Check
      label={t('cfg.f.active')}
      value={value.active !== false}
      onChange={(active) => onChange({ ...value, active })}
    />
  );
}

function Position({ value, onChange }: Omit<FormProps, 'isNew'>) {
  const { t } = useTranslation();
  return (
    <NumIn
      label={t('cfg.f.position')}
      value={value.position ?? 0}
      min={0}
      onChange={(n) => onChange({ ...value, position: n ?? 0 })}
    />
  );
}

// ----------------------------------------------------------------- resources

function GroupForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const followUp = useOptions('cfg.followUp', ['reopen', 'new_ticket']);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <TextIn label={t('cfg.f.emailAddress')} type="email" {...b('emailAddress', null)} />
        <RefSelect
          label={t('cfg.f.signature')}
          source="signatures"
          empty
          {...b('signatureId', null)}
        />
        <SelectIn label={t('cfg.f.followUp')} options={followUp} {...b('followUp')} />
      </Grid>
      <Check label={t('cfg.f.autoAssign')} {...b('autoAssign')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function PriorityForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <NumIn label={t('cfg.f.rank')} min={1} max={20} {...b('rank')} />
      </Grid>
      <Check label={t('cfg.f.isDefault')} {...b('isDefault')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function CustomRoleForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const perms = t('cfg.perm', { returnObjects: true }) as Record<string, string>;
  const options = Object.values(Permission)
    .filter((p) => p !== Permission.TicketsCustomer)
    .map((p) => [p, perms[p] ?? p] as const);
  return (
    <>
      <TextIn label={t('cfg.f.name')} {...b('name')} />
      <TextArea label={t('cfg.f.description')} rows={2} {...b('description', null)} />
      <MultiCheck label={t('cfg.f.permissions')} options={options} {...b('permissions')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function SupportPlanForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const cents = numOrNull(value.hourlyRateCents);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <NumIn label={t('cfg.f.includedMinutes')} min={0} {...b('includedMinutesPerMonth', null)} />
        <NumIn
          label={t('cfg.f.hourlyRate')}
          min={0}
          step={0.01}
          value={cents === null ? null : cents / 100}
          onChange={(n) =>
            onChange({ ...value, hourlyRateCents: n === null ? null : Math.round(n * 100) })
          }
        />
      </Grid>
      <Active value={value} onChange={onChange} />
    </>
  );
}

function SignatureForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  return (
    <>
      <TextIn label={t('cfg.f.name')} {...b('name')} />
      <TextArea
        label={t('cfg.f.body')}
        rows={6}
        hint={t('cfg.variablesHint', { vars: '{{agent.name}} {{config.app_name}}' })}
        {...b('body')}
      />
      <Active value={value} onChange={onChange} />
    </>
  );
}

const DAY_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

function CalendarForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const days = t('cfg.days', { returnObjects: true }) as string[];
  const hours = rec(value.hours);
  const setDay = (day: string, ranges: string[][]) => {
    const { [day]: _drop, ...rest } = hours;
    onChange({ ...value, hours: ranges.length ? { ...rest, [day]: ranges } : rest });
  };
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <TextIn label={t('cfg.f.timezone')} placeholder="America/Mexico_City" {...b('timezone')} />
      </Grid>
      <Section title={t('cfg.f.hours')}>
        {DAY_ORDER.map((day) => {
          const ranges = (Array.isArray(hours[day]) ? hours[day] : []) as string[][];
          return (
            <div key={day} className="grid gap-2 sm:grid-cols-[8rem_1fr]">
              <span className="pt-2 text-sm font-medium">{days[Number(day)]}</span>
              <Rows
                items={ranges}
                onChange={(r) => setDay(day, r)}
                make={() => ['09:00', '18:00']}
                max={4}
                addLabel={t('cfg.addRange')}
                render={(r, set) => (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      className="input w-auto"
                      aria-label={`${days[Number(day)]} 1`}
                      value={str(r[0])}
                      onChange={(e) => set([e.target.value, str(r[1])])}
                    />
                    –
                    <input
                      type="time"
                      className="input w-auto"
                      aria-label={`${days[Number(day)]} 2`}
                      value={str(r[1])}
                      onChange={(e) => set([str(r[0]), e.target.value])}
                    />
                  </div>
                )}
              />
            </div>
          );
        })}
      </Section>
      <Rows
        label={t('cfg.f.holidays')}
        items={strs(value.holidays)}
        onChange={(holidays) => onChange({ ...value, holidays })}
        make={() => ''}
        max={200}
        addLabel={t('cfg.addHoliday')}
        render={(d, set) => (
          <input
            type="date"
            className="input w-auto"
            aria-label={t('cfg.f.holidays')}
            value={d}
            onChange={(e) => set(e.target.value)}
          />
        )}
      />
      <Check label={t('cfg.f.mexicoStatutory')} {...b('mexicoStatutory')} />
      <Check label={t('cfg.f.isDefault')} {...b('isDefault')} />
    </>
  );
}

function SlaForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const minutes = (key: string, target: Rec, set: (v: Rec) => void) => (
    <NumIn
      label={t(`cfg.f.${key}`)}
      min={1}
      value={target[`${key}Minutes`]}
      onChange={(n) => set({ ...target, [`${key}Minutes`]: n })}
    />
  );
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <RefSelect label={t('cfg.f.calendar')} source="calendars" {...b('calendarId')} />
        <NumIn label={t('cfg.f.warnPercent')} min={10} max={99} {...b('warnPercent')} />
        <Position value={value} onChange={onChange} />
      </Grid>
      <Check label={t('cfg.f.pauseOnPending')} {...b('pauseOnPending')} />
      <Section title={t('cfg.f.conditions')}>
        <ConditionEditor usage={{ event: false, queryable: false }} {...b('conditions')} />
      </Section>
      <Rows
        label={t('cfg.f.targets')}
        items={recs(value.targets)}
        onChange={(targets) => onChange({ ...value, targets })}
        make={() => ({
          priorityId: '',
          firstResponseMinutes: null,
          updateMinutes: null,
          solutionMinutes: null,
        })}
        max={20}
        render={(target, set) => (
          <div className="space-y-2">
            <RefSelect
              label={t('cfg.f.priority')}
              source="priorities"
              value={target.priorityId}
              onChange={(priorityId) => set({ ...target, priorityId: priorityId ?? '' })}
            />
            <div className="grid gap-2 sm:grid-cols-3">
              {minutes('firstResponse', target, set)}
              {minutes('update', target, set)}
              {minutes('solution', target, set)}
            </div>
            <p className="text-xs text-slate-500">{t('cfg.minutesHint')}</p>
          </div>
        )}
      />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function TriggerForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const events = useOptions('cfg.event', ['create', 'update', 'create_or_update']);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <SelectIn label={t('cfg.f.event')} options={events} {...b('event')} />
        <Position value={value} onChange={onChange} />
      </Grid>
      <Section title={t('cfg.f.conditions')}>
        <ConditionEditor usage={{ event: true, queryable: false }} {...b('conditions')} />
      </Section>
      <ActionsEditor {...b('actions')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function SchedulerForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <NumIn
          label={t('cfg.f.intervalMinutes')}
          min={10}
          max={10080}
          hint={t('cfg.minutesHint')}
          {...b('intervalMinutes')}
        />
        <NumIn label={t('cfg.f.limitPerRun')} min={1} max={2000} {...b('limitPerRun')} />
        <RefSelect
          label={t('cfg.f.calendar')}
          source="calendars"
          empty
          {...b('calendarId', null)}
        />
      </Grid>
      <Section title={t('cfg.f.conditions')}>
        <ConditionEditor usage={{ event: false, queryable: true }} {...b('conditions')} />
      </Section>
      <ActionsEditor {...b('actions')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function CoreWorkflowForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const screens = useOptions('cfg.screen', WorkflowScreens);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <Position value={value} onChange={onChange} />
      </Grid>
      <MultiCheck label={t('cfg.f.screens')} options={screens} {...b('screens')} />
      <Section title={t('cfg.f.conditions')}>
        <ConditionEditor usage={{ event: false, queryable: false }} {...b('conditions')} />
      </Section>
      <WorkflowActionsEditor {...b('actions')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function MacroForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  return (
    <>
      <TextIn label={t('cfg.f.name')} {...b('name')} />
      <ActionsEditor {...b('actions')} />
      <RefMulti label={t('cfg.f.groups')} source="groups" {...b('groupIds')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function TextModuleForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.keyword')} placeholder="saludo" {...b('keyword')} />
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <SelectIn
          label={t('cfg.f.locale')}
          options={[
            ['es-MX', 'Español'],
            ['en', 'English'],
          ]}
          {...b('locale')}
        />
      </Grid>
      <TextArea label={t('cfg.f.content')} rows={6} {...b('content')} />
      <RefMulti label={t('cfg.f.groups')} source="groups" {...b('groupIds')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function TicketTemplateForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const fields = rec(value.fields);
  const f = binder(fields, (v) => onChange({ ...value, fields: v }));
  const states = useOptions('states', TicketStates);
  return (
    <>
      <TextIn label={t('cfg.f.name')} {...b('name')} />
      <Section title={t('cfg.f.fieldEffects')}>
        <TextIn label={t('cfg.f.title')} {...f('title', 'omit')} />
        <Grid>
          <RefSelect label={t('cfg.f.group')} source="groups" empty {...f('groupId', 'omit')} />
          <RefSelect
            label={t('cfg.f.priority')}
            source="priorities"
            empty
            {...f('priorityId', 'omit')}
          />
          <SelectIn label={t('cfg.f.state')} options={states} empty {...f('state', 'omit')} />
        </Grid>
        <TextArea label={t('cfg.f.body')} rows={5} {...f('body', 'omit')} />
        <ListIn
          label={t('cfg.f.tags')}
          value={fields.tags}
          onChange={(tags) => f('tags', 'omit').onChange(tags.length ? tags : null)}
        />
      </Section>
      <Active value={value} onChange={onChange} />
    </>
  );
}

const COLUMNS = [
  'number',
  'title',
  'state',
  'priority',
  'group',
  'owner',
  'customer',
  'organization',
  'created_at',
  'updated_at',
  'escalation_at',
  'pending_until',
  'last_customer_contact_at',
];
const ORDER_COLUMNS = [
  'number',
  'title',
  'state',
  'created_at',
  'updated_at',
  'escalation_at',
  'pending_until',
  'last_customer_contact_at',
];

function OverviewForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const columns = useOptions('cfg.column', COLUMNS);
  const orderColumns = useOptions('cfg.column', ORDER_COLUMNS);
  const dirs = useOptions('cfg.dir', ['asc', 'desc']);
  const roles = useOptions('cfg.role', Roles);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <TextIn label={t('cfg.f.slug')} placeholder="mis-abiertos" {...b('slug')} />
        <SelectIn label={t('cfg.f.orderBy')} options={orderColumns} {...b('orderBy')} />
        <SelectIn label={t('cfg.f.orderDir')} options={dirs} {...b('orderDir')} />
        <Position value={value} onChange={onChange} />
      </Grid>
      <MultiCheck label={t('cfg.f.columns')} options={columns} {...b('columns')} />
      <MultiCheck label={t('cfg.f.roles')} options={roles} {...b('roles')} />
      <Section title={t('cfg.f.conditions')}>
        <ConditionEditor usage={{ event: false, queryable: true }} {...b('conditions')} />
      </Section>
      <Active value={value} onChange={onChange} />
    </>
  );
}

function ObjectAttributeForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const objects = useOptions('cfg.attrObject', ['ticket', 'user', 'organization']);
  const types = useOptions('cfg.dataType', ObjectAttributeTypes);
  const withOptions = ['select', 'multiselect'].includes(str(value.dataType));
  return (
    <>
      <Grid>
        <SelectIn label={t('cfg.f.object')} options={objects} {...b('object')} />
        <TextIn label={t('cfg.f.fieldName')} placeholder="modulo" {...b('name')} />
        <TextIn label={t('cfg.f.label')} {...b('label')} />
        <TextIn label={t('cfg.f.labelEn')} {...b('labelEn', null)} />
        <SelectIn label={t('cfg.f.dataType')} options={types} {...b('dataType')} />
        <Position value={value} onChange={onChange} />
      </Grid>
      {withOptions && (
        <Rows
          label={t('cfg.f.options')}
          items={recs(value.options)}
          onChange={(options) => onChange({ ...value, options })}
          make={() => ({ value: '', label: '' })}
          max={200}
          render={(o, set) => {
            const ob = binder(o, set);
            return (
              <div className="grid gap-2 sm:grid-cols-3">
                <TextIn label={t('cfg.f.value')} {...ob('value')} />
                <TextIn label={t('cfg.f.label')} {...ob('label')} />
                <TextIn label={t('cfg.f.labelEn')} {...ob('labelEn', 'omit')} />
              </div>
            );
          }}
        />
      )}
      <Check label={t('cfg.f.required')} {...b('required')} />
      <Check label={t('cfg.f.visibleToCustomer')} {...b('visibleToCustomer')} />
      <Check label={t('cfg.f.editableByCustomer')} {...b('editableByCustomer')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function ActivityTypeForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  return (
    <>
      <TextIn label={t('cfg.f.name')} {...b('name')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

const GRAPH_CONFIG = { tenantId: '', clientId: '', mailbox: '', folder: 'inbox' };
const IMAP_CONFIG = {
  host: '',
  port: 993,
  secure: true,
  user: '',
  mailbox: 'INBOX',
  smtp: { host: '', port: 587, secure: false },
};

function EmailChannelForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const adapters = useOptions('cfg.adapterKind', ['graph', 'imap']);
  const config = rec(value.config);
  const setConfig = (v: Rec) => onChange({ ...value, config: v });
  const c = binder(config, setConfig);
  const smtp = rec(config.smtp);
  const s = binder(smtp, (v) => setConfig({ ...config, smtp: v }));
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <TextIn label={t('cfg.f.address')} type="email" {...b('address')} />
        <RefSelect label={t('cfg.f.group')} source="groups" {...b('groupId')} />
        <SelectIn
          label={t('cfg.f.adapter')}
          options={adapters}
          value={value.adapter}
          onChange={(adapter) =>
            onChange({
              ...value,
              adapter,
              config: adapter === 'imap' ? IMAP_CONFIG : GRAPH_CONFIG,
            })
          }
        />
      </Grid>
      <Section title={t(`cfg.adapterKind.${str(value.adapter) || 'graph'}`)}>
        {value.adapter === 'imap' ? (
          <>
            <Grid>
              <TextIn label={t('cfg.f.host')} {...c('host')} />
              <NumIn label={t('cfg.f.port')} min={1} max={65535} {...c('port')} />
              <TextIn label={t('cfg.f.user')} {...c('user')} />
              <TextIn label={t('cfg.f.mailbox')} {...c('mailbox')} />
              <TextIn label={t('cfg.f.processedMailbox')} {...c('processedMailbox', 'omit')} />
            </Grid>
            <Check label={t('cfg.f.secure')} {...c('secure')} />
            <Section title={t('cfg.f.smtp')}>
              <Grid>
                <TextIn label={t('cfg.f.host')} {...s('host')} />
                <NumIn label={t('cfg.f.port')} min={1} max={65535} {...s('port')} />
                <TextIn label={t('cfg.f.user')} {...s('user', 'omit')} />
              </Grid>
              <Check label={t('cfg.f.secure')} {...s('secure')} />
            </Section>
          </>
        ) : (
          <Grid>
            <TextIn label={t('cfg.f.tenantId')} {...c('tenantId')} />
            <TextIn label={t('cfg.f.clientId')} {...c('clientId')} />
            <TextIn label={t('cfg.f.mailbox')} type="email" {...c('mailbox')} />
            <TextIn label={t('cfg.f.folder')} {...c('folder')} />
          </Grid>
        )}
      </Section>
      <Grid>
        <TextIn
          label={t('cfg.f.secretName')}
          placeholder={value.adapter === 'imap' ? 'imap_password' : 'graph_client_secret'}
          hint={t('cfg.secretNameHint')}
          {...b('secretName', null)}
        />
        <TextIn
          label={t('cfg.f.trustedAuthServ')}
          placeholder="mx.microsoft.com"
          hint={t('cfg.trustedAuthServHint')}
          {...b('trustedAuthServ', null)}
        />
      </Grid>
      <Active value={value} onChange={onChange} />
    </>
  );
}

const MATCH_HEADERS = ['from', 'to', 'cc', 'subject', 'reply-to', 'x-spam-flag'];

function PostmasterFilterForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const ops = useOptions('cfg.pmOp', ['contains', 'is', 'starts_with', 'ends_with']);
  const set = rec(value.set);
  const sb = binder(set, (v) => onChange({ ...value, set: v }));
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <Position value={value} onChange={onChange} />
      </Grid>
      <Rows
        label={t('cfg.f.match')}
        items={recs(value.match)}
        onChange={(match) => onChange({ ...value, match })}
        make={() => ({ header: 'from', operator: 'contains', value: '' })}
        max={10}
        render={(m, setM) => {
          const mb = binder(m, setM);
          return (
            <div className="grid gap-2 sm:grid-cols-3">
              <TextIn label={t('cfg.f.header')} hint={MATCH_HEADERS.join(', ')} {...mb('header')} />
              <SelectIn label={t('cfg.f.operator')} options={ops} {...mb('operator')} />
              <TextIn label={t('cfg.f.value')} {...mb('value')} />
            </div>
          );
        }}
      />
      <Section title={t('cfg.f.setValues')}>
        <Grid>
          <RefSelect label={t('cfg.f.group')} source="groups" empty {...sb('groupId', 'omit')} />
          <RefSelect
            label={t('cfg.f.priority')}
            source="priorities"
            empty
            {...sb('priorityId', 'omit')}
          />
        </Grid>
        <ListIn
          label={t('cfg.f.tags')}
          value={set.tags}
          onChange={(tags) => sb('tags', 'omit').onChange(tags.length ? tags : null)}
        />
        <Check label={t('cfg.f.ignore')} {...sb('ignore')} />
        <Check label={t('cfg.f.spam')} {...sb('spam')} />
      </Section>
      <Active value={value} onChange={onChange} />
    </>
  );
}

function WebhookForm({ value, onChange, isNew }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <TextIn label={t('cfg.f.url')} type="url" placeholder="https://" {...b('url')} />
      </Grid>
      <TextIn
        label={t('cfg.f.secret')}
        type="password"
        hint={isNew ? undefined : t('cfg.keepSecret')}
        {...b('secret', 'omit')}
      />
      <Active value={value} onChange={onChange} />
    </>
  );
}

const TEAMS_EVENTS = [
  'ticket_created',
  'ticket_assigned',
  'customer_reply',
  'sla_warning',
  'sla_breach',
];

function TeamsChannelForm({ value, onChange, isNew }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const events = useOptions('cfg.teamsEvent', TEAMS_EVENTS);
  return (
    <>
      <Grid>
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <RefSelect label={t('cfg.f.group')} source="groups" {...b('groupId')} />
      </Grid>
      <TextIn
        label={t('cfg.f.url')}
        type="password"
        placeholder="https://<tenant>.webhook.office.com/…"
        hint={isNew ? undefined : t('cfg.keepSecret')}
        {...b('url', 'omit')}
      />
      <MultiCheck label={t('cfg.f.events')} options={events} {...b('events')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

function MessagingChannelForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const kinds = useOptions('cfg.msgKind', ['whatsapp', 'sms']);
  return (
    <>
      <Grid>
        <SelectIn label={t('cfg.f.kind')} options={kinds} {...b('kind')} />
        <TextIn label={t('cfg.f.name')} {...b('name')} />
        <TextIn label={t('cfg.f.providerId')} hint={t('cfg.providerIdHint')} {...b('providerId')} />
        <TextIn label={t('cfg.f.displayNumber')} placeholder="+52…" {...b('displayNumber')} />
        <RefSelect label={t('cfg.f.group')} source="groups" {...b('groupId')} />
      </Grid>
      <Active value={value} onChange={onChange} />
    </>
  );
}

function RetentionPolicyForm({ value, onChange }: FormProps) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  return (
    <>
      <p className="text-sm">
        <span className="font-medium">{t('cfg.f.target')}:</span> {str(value.target)}
      </p>
      <NumIn label={t('cfg.f.days')} min={1} max={36500} {...b('days')} />
      <Active value={value} onChange={onChange} />
    </>
  );
}

const FORMS: Record<string, (p: FormProps) => ReactElement> = {
  groups: GroupForm,
  priorities: PriorityForm,
  'custom-roles': CustomRoleForm,
  'support-plans': SupportPlanForm,
  signatures: SignatureForm,
  calendars: CalendarForm,
  slas: SlaForm,
  triggers: TriggerForm,
  schedulers: SchedulerForm,
  'core-workflows': CoreWorkflowForm,
  macros: MacroForm,
  'text-modules': TextModuleForm,
  'ticket-templates': TicketTemplateForm,
  overviews: OverviewForm,
  'object-attributes': ObjectAttributeForm,
  'activity-types': ActivityTypeForm,
  'email-channels': EmailChannelForm,
  'postmaster-filters': PostmasterFilterForm,
  webhooks: WebhookForm,
  'teams-channels': TeamsChannelForm,
  'messaging-channels': MessagingChannelForm,
  'retention-policies': RetentionPolicyForm,
};

export const FORM_RESOURCES = Object.keys(FORMS);

export function ResourceForm(props: { resource: string } & FormProps) {
  const Form = FORMS[props.resource];
  if (!Form) return null;
  return (
    <div className="space-y-3">
      <Form value={props.value} onChange={props.onChange} isNew={props.isNew} />
    </div>
  );
}

// ------------------------------------------------------------------ settings

/** Application settings (GET/PUT /admin/settings). */
export function SettingsForm({ value, onChange }: Omit<FormProps, 'isNew'>) {
  const { t } = useTranslation();
  const b = binder(value, onChange);
  const sub = (key: string) => binder(rec(value[key]), (v) => onChange({ ...value, [key]: v }));
  const ta = sub('time_accounting');
  const pn = sub('privacy_notice');
  const ado = sub('azure_devops');
  const inn = sub('inncentives');
  const msg = sub('messaging');
  const chat = sub('chat');
  const ai = sub('ai');
  const br = sub('branding');
  const locales = [
    ['es-MX', 'Español'],
    ['en', 'English'],
  ] as const;
  const modes = useOptions('cfg.s.modes', ['off', 'mock', 'http']);
  const workItems = ['Bug', 'Task', 'User Story', 'Issue'].map((x) => [x, x] as const);
  const areas = useOptions('cfg.s.area', ['agent', 'portal']);
  return (
    <div className="space-y-4">
      <Section title={t('cfg.s.general')}>
        <Grid>
          <TextIn label={t('cfg.s.productName')} {...br('productName')} />
          <TextIn label={t('cfg.s.primaryColor')} type="color" {...br('primaryColor')} />
          <SelectIn label={t('cfg.s.defaultLocale')} options={locales} {...b('default_locale')} />
          <TextIn label={t('cfg.s.ticketHook')} {...b('ticket_hook')} />
        </Grid>
      </Section>
      <Section title={t('cfg.s.tickets')}>
        <Grid>
          <RefSelect label={t('cfg.s.portalGroup')} source="groups" {...b('portal_group_id')} />
          <NumIn
            label={t('cfg.s.autoReplyLimit')}
            min={0}
            max={100}
            {...b('auto_reply_limit_per_hour')}
          />
        </Grid>
        <Check label={t('cfg.s.customerCanClose')} {...b('customer_can_close')} />
        <Check label={t('cfg.s.timeAccounting')} {...ta('enabled')} />
        <Check label={t('cfg.s.timeRequired')} {...ta('required')} />
      </Section>
      <Section title={t('cfg.s.privacyNotice')}>
        <TextArea label="Español" rows={4} {...pn('es')} />
        <TextArea label="English" rows={4} {...pn('en')} />
      </Section>
      <Section title={t('cfg.s.chat')}>
        <Check label={t('cfg.s.enabled')} {...chat('enabled')} />
        <Grid>
          <RefSelect label={t('cfg.f.group')} source="groups" {...chat('groupId')} />
          <NumIn label={t('cfg.s.idleMinutes')} min={2} max={240} {...chat('idleMinutes')} />
        </Grid>
      </Section>
      <Section title={t('cfg.s.messaging')}>
        <Grid>
          <TextIn label={t('cfg.s.whatsappApiVersion')} {...msg('whatsappApiVersion')} />
          <TextIn label={t('cfg.s.twilioAccountSid')} {...msg('twilioAccountSid')} />
          <NumIn label={t('cfg.s.reopenDays')} min={0} max={90} {...msg('reopenDays')} />
        </Grid>
      </Section>
      <Section title="Azure DevOps">
        <Grid>
          <TextIn label={t('cfg.s.organization')} {...ado('organization')} />
          <TextIn label={t('cfg.s.project')} {...ado('project')} />
          <SelectIn label={t('cfg.s.defaultType')} options={workItems} {...ado('defaultType')} />
          <TextIn label={t('cfg.f.secretName')} {...ado('secretName')} />
        </Grid>
      </Section>
      <Section title="Inncentives">
        <Grid>
          <SelectIn label={t('cfg.s.mode')} options={modes} {...inn('mode')} />
          <TextIn
            label={t('cfg.s.baseUrl')}
            type="url"
            placeholder="https://"
            {...inn('baseUrl')}
          />
          <TextIn label={t('cfg.f.secretName')} {...inn('secretName')} />
          <TextIn label={t('cfg.s.widgetSecretName')} {...inn('widgetSecretName')} />
          <TextIn label={t('cfg.s.widgetIssuer')} {...inn('widgetIssuer')} />
        </Grid>
      </Section>
      <Section title={t('cfg.s.ai')}>
        <Check label={t('cfg.s.enabled')} {...ai('enabled')} />
        <Grid>
          <TextIn label={t('cfg.s.model')} {...ai('model')} />
          <TextIn label={t('cfg.f.secretName')} {...ai('secretName')} />
        </Grid>
      </Section>
      <Section title={t('cfg.s.sso')}>
        <Rows
          items={recs(value.sso_providers)}
          onChange={(sso_providers) => onChange({ ...value, sso_providers })}
          make={() => ({
            id: '',
            label: '',
            area: 'agent',
            issuer: '',
            clientId: '',
            secretName: '',
            scopes: 'openid profile email',
            trustIdpMfa: false,
          })}
          max={5}
          render={(p, set) => {
            const pb = binder(p, set);
            return (
              <div className="space-y-2">
                <Grid>
                  <TextIn label={t('cfg.s.providerId')} placeholder="entra" {...pb('id')} />
                  <TextIn label={t('cfg.f.label')} {...pb('label')} />
                  <SelectIn label={t('cfg.s.areaLabel')} options={areas} {...pb('area')} />
                  <TextIn label={t('cfg.s.issuer')} type="url" {...pb('issuer')} />
                  <TextIn label={t('cfg.f.clientId')} {...pb('clientId')} />
                  <TextIn label={t('cfg.f.secretName')} {...pb('secretName')} />
                  <TextIn label={t('cfg.s.scopes')} {...pb('scopes')} />
                </Grid>
                <Check label={t('cfg.s.trustIdpMfa')} {...pb('trustIdpMfa')} />
              </div>
            );
          }}
        />
      </Section>
    </div>
  );
}

// -------------------------------------------------------------- group access

/** A staff member's access per group: [{ groupId, levels }]. */
export function GroupAccessForm(props: { value: Rec[]; onChange: (v: Rec[]) => void }) {
  const { t } = useTranslation();
  const levels = useOptions('cfg.level', GroupAccessLevels);
  return (
    <Rows
      items={props.value}
      onChange={props.onChange}
      make={() => ({ groupId: '', levels: ['full'] })}
      max={100}
      addLabel={t('cfg.access.add')}
      render={(g, set) => {
        const gb = binder(g, set);
        return (
          <div className="space-y-2">
            <RefSelect label={t('cfg.f.group')} source="groups" {...gb('groupId')} />
            <MultiCheck label={t('cfg.f.levels')} options={levels} {...gb('levels')} />
          </div>
        );
      }}
    />
  );
}
