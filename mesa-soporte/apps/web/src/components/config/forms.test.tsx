import {
  ActionsSchema,
  ConditionSchema,
  validateCondition,
  type ConditionNode,
} from '@mesa/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import type { Rec } from './fields';
import { FORM_RESOURCES, ResourceForm, SettingsForm } from './forms';
import { TEMPLATES } from './templates';

const GROUP = '00000000-0000-4000-8000-000000000301';
const PRIORITY = '00000000-0000-4000-8000-000000000102';

const DATA: Record<string, unknown> = {
  '/admin/config/groups': [{ id: GROUP, name: 'Soporte' }],
  '/admin/config/priorities': [{ id: PRIORITY, name: 'Normal' }],
  '/admin/config/object-attributes': [
    {
      id: 'a1',
      object: 'ticket',
      name: 'modulo',
      label: 'Módulo',
      dataType: 'select',
      options: [{ value: 'nomina', label: 'Nómina' }],
      active: true,
    },
  ],
  '/admin/users?limit=100': { items: [] },
  '/admin/organizations?limit=100': { items: [] },
};

beforeEach(async () => {
  await i18n.changeLanguage('es');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.replace('/api/v1', '');
      return new Response(JSON.stringify(DATA[path] ?? []), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders a form with real state and exposes the latest value. */
function mount(resource: string, initial: Rec) {
  const latest = { value: initial };
  function Harness() {
    const [value, setValue] = useState(initial);
    latest.value = value;
    return <ResourceForm resource={resource} value={value} onChange={setValue} isNew={true} />;
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );
  return latest;
}

describe('configuration forms', () => {
  it.each(FORM_RESOURCES)('renders %s without a JSON editor', (resource) => {
    mount(resource, TEMPLATES[resource] ?? { target: 'tickets', days: 365, active: true });
    expect(screen.queryByText(/JSON/)).toBeNull();
    expect(document.querySelectorAll('input, select, textarea').length).toBeGreaterThan(0);
  });

  it('edits the name, conditions and actions of a trigger', async () => {
    const latest = mount('triggers', structuredClone(TEMPLATES.triggers!));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Correo VIP' } });
    fireEvent.click(screen.getByText('Agregar condición'));
    fireEvent.change(screen.getByLabelText('Campo', { selector: 'select' }), {
      target: { value: 'ticket.tags' },
    });
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: 'vip, urgente' } });
    fireEvent.change(screen.getByLabelText('Etiquetas'), { target: { value: 'revisar' } });

    const v = latest.value;
    expect(v.name).toBe('Correo VIP');
    const cond = ConditionSchema.parse(v.conditions);
    expect(cond).toEqual({
      op: 'and',
      conditions: [{ field: 'ticket.tags', operator: 'contains_all', value: ['vip', 'urgente'] }],
    });
    expect(validateCondition(cond as ConditionNode, { event: true, queryable: false })).toEqual([]);
    expect(ActionsSchema.parse(v.actions)).toEqual([{ type: 'add_tags', tags: ['revisar'] }]);
  });

  it('offers groups by name and stores their id', async () => {
    const latest = mount('teams-channels', structuredClone(TEMPLATES['teams-channels']!));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Soporte' })).toBeTruthy());
    expect(latest.value.groupId).toBe(GROUP);
  });

  it('switches the e-mail adapter configuration', () => {
    const latest = mount('email-channels', structuredClone(TEMPLATES['email-channels']!));
    fireEvent.change(screen.getByLabelText('Conexión'), { target: { value: 'imap' } });
    expect(latest.value.config).toMatchObject({ host: '', port: 993, smtp: { port: 587 } });
    expect(screen.getByText('Envío (SMTP)')).toBeTruthy();
  });

  it('edits calendar hours per day', () => {
    const latest = mount('calendars', structuredClone(TEMPLATES.calendars!));
    fireEvent.click(screen.getAllByText('Agregar horario')[5]!); // Saturday
    expect((latest.value.hours as Rec)['6']).toEqual([['09:00', '18:00']]);
  });

  it('renders the settings form', () => {
    function Harness() {
      const [v, setV] = useState<Rec>({
        chat: { enabled: false, groupId: GROUP, idleMinutes: 15 },
      });
      return <SettingsForm value={v} onChange={setV} />;
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Chat en vivo')).toBeTruthy();
  });
});
