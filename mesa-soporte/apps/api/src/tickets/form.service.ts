import { Injectable } from '@nestjs/common';
import { TicketStates, WorkflowScreens, type WorkflowScreen } from '@mesa/shared';
import { z } from 'zod';
import { WorkflowsService } from '../automation/workflows.service';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import type { TicketSnapshot } from '../rules/conditions';
import { ticketSnapshot } from '../rules/snapshot';
import { SettingsService } from '../settings/settings.service';
import { TicketAccessService } from './access.service';

const EvaluateSchema = z
  .object({
    screen: z.enum(WorkflowScreens),
    ticketId: z.string().uuid().optional(),
    values: z
      .object({
        title: z.string().max(250).optional(),
        state: z.string().max(20).optional(),
        priority_id: z.string().uuid().optional(),
        group_id: z.string().uuid().optional(),
        owner_id: z.string().uuid().nullable().optional(),
        customer_id: z.string().uuid().optional(),
        custom: z.record(z.string().max(40), z.unknown()).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

const CHANGE_LEVELS = ['full', 'change'];

/** Data the ticket forms need, and live evaluation of core workflows. */
@Injectable()
export class FormService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TicketAccessService,
    private readonly workflows: WorkflowsService,
    private readonly settings: SettingsService,
  ) {}

  async formMeta(actor: AuthenticatedUser) {
    const attrs = await this.prisma.objectAttribute.findMany({
      where: { object: 'ticket', active: true },
      orderBy: { position: 'asc' },
    });
    const attrDto = (a: (typeof attrs)[number]) => ({
      name: a.name,
      label: a.label,
      labelEn: a.labelEn,
      dataType: a.dataType,
      options: a.options,
      required: a.required,
      editableByCustomer: a.editableByCustomer,
    });
    if (!this.access.isStaff(actor)) {
      return {
        attributes: attrs.filter((a) => a.visibleToCustomer).map(attrDto),
        privacyNotice: await this.settings.get('privacy_notice'),
        customerCanClose: await this.settings.get('customer_can_close'),
      };
    }
    const createIds = await this.access.groupIds(actor, 'create');
    const [groups, priorities, activityTypes, textModules, templates, macros, owners] =
      await Promise.all([
        this.prisma.group.findMany({
          where: { active: true, ...(createIds === 'all' ? {} : { id: { in: createIds } }) },
          select: { id: true, name: true, isTriage: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.ticketPriority.findMany({ where: { active: true }, orderBy: { rank: 'asc' } }),
        this.prisma.activityType.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
        this.prisma.textModule.findMany({
          where: { active: true },
          orderBy: { keyword: 'asc' },
          take: 500,
        }),
        this.prisma.ticketTemplate.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
        this.prisma.macro.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, groupIds: true },
        }),
        this.prisma.groupAccess.findMany({
          where: {
            levels: { hasSome: CHANGE_LEVELS },
            user: { status: 'ACTIVE', role: { in: ['ADMIN', 'AGENT'] } },
          },
          select: { groupId: true, user: { select: { id: true, name: true } } },
        }),
      ]);
    const ownersByGroup: Record<string, Array<{ id: string; name: string }>> = {};
    for (const o of owners) (ownersByGroup[o.groupId] ??= []).push(o.user);
    return {
      groups,
      priorities: priorities.map((p) => ({
        id: p.id,
        name: p.name,
        rank: p.rank,
        isDefault: p.isDefault,
      })),
      states: TicketStates.filter((s) => s !== 'merged'),
      attributes: attrs.map(attrDto),
      activityTypes: activityTypes.map((a) => ({ id: a.id, name: a.name })),
      textModules: textModules.map((t) => ({
        id: t.id,
        keyword: t.keyword,
        name: t.name,
        content: t.content,
        locale: t.locale,
        groupIds: t.groupIds,
      })),
      templates: templates.map((t) => ({ id: t.id, name: t.name, fields: t.fields })),
      macros,
      ownersByGroup,
      timeAccounting: await this.settings.get('time_accounting'),
    };
  }

  async evaluateForm(actor: AuthenticatedUser, body: unknown) {
    const parsed = EvaluateSchema.safeParse(body);
    if (!parsed.success) throw new AppError('validation_failed');
    const { screen, ticketId, values } = parsed.data;
    const staff = this.access.isStaff(actor);
    const allowed: WorkflowScreen[] = staff
      ? ['create_agent', 'edit_agent']
      : ['create_customer', 'edit_customer'];
    if (!allowed.includes(screen)) throw new AppError('forbidden');
    let base: TicketSnapshot;
    if (ticketId) {
      base = ticketSnapshot(await this.access.load(actor, ticketId, 'read', { tags: true }));
    } else {
      const now = new Date();
      base = {
        number: '',
        title: '',
        state: 'new',
        priorityId: '',
        groupId: '',
        ownerId: null,
        customerId: staff ? null : actor.id,
        organizationId: staff ? null : actor.organizationId,
        tags: [],
        channel: staff ? 'agent' : 'web',
        pendingUntil: null,
        escalationAt: null,
        createdAt: now,
        updatedAt: now,
        lastCustomerContactAt: null,
        sensitiveData: false,
        customFields: {},
      };
    }
    const ticket: TicketSnapshot = {
      ...base,
      title: values.title ?? base.title,
      state: values.state ?? base.state,
      priorityId: values.priority_id ?? base.priorityId,
      groupId: values.group_id ?? base.groupId,
      ownerId: values.owner_id !== undefined ? values.owner_id : base.ownerId,
      customerId: staff && values.customer_id ? values.customer_id : base.customerId,
      customFields: { ...base.customFields, ...(values.custom ?? {}) },
    };
    return { fields: await this.workflows.evaluate(screen, { ticket, currentUserId: actor.id }) };
  }

  /** Customer lookup for agents (name, e-mail or phone). */
  async searchCustomers(actor: AuthenticatedUser, q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    const digits = term.replace(/\D/g, '');
    return this.prisma.user.findMany({
      where: {
        role: 'CUSTOMER',
        status: 'ACTIVE',
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term.toLowerCase() } },
          ...(digits.length >= 4
            ? [{ phone: { contains: digits } }, { mobile: { contains: digits } }]
            : []),
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        organization: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }
}
