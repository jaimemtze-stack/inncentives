import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { SlaService } from '../automation/sla.service';
import { AppError } from '../common/errors';
import { teamsUrlAad } from '../integrations/teams';
import { webhookSecretAad } from '../jobs/webhook-caller.service';
import { PrismaService } from '../prisma/prisma.service';
import { FieldEncryption } from '../security/field-encryption';
import { RESOURCES, RuleValidationError, type ResourceDef } from './resources';

interface Delegate {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  create(args: unknown): Promise<Record<string, unknown>>;
  update(args: unknown): Promise<Record<string, unknown>>;
  updateMany(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
}

type Db = Prisma.TransactionClient;

/** Generic CRUD for admin configuration, validated and audited. */
@Injectable()
export class ConfigAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: FieldEncryption,
    private readonly sla: SlaService,
  ) {}

  private def(resource: string): ResourceDef {
    const d = Object.prototype.hasOwnProperty.call(RESOURCES, resource)
      ? RESOURCES[resource]
      : undefined;
    if (!d) throw new AppError('not_found');
    return d;
  }

  private delegate(db: Db, d: ResourceDef): Delegate {
    return (db as unknown as Record<string, Delegate>)[d.model]!;
  }

  private parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
    const r = schema.safeParse(body);
    if (!r.success) {
      throw new AppError(
        'validation_failed',
        'Invalid input.',
        r.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      );
    }
    return r.data;
  }

  private validate(d: ResourceDef, data: Record<string, unknown>): string[] {
    try {
      return d.validate?.(data) ?? [];
    } catch (err) {
      if (err instanceof RuleValidationError) {
        throw new AppError(
          'validation_failed',
          'Invalid rule.',
          err.issues.map((m) => ({ path: 'rule', code: m.slice(0, 200) })),
        );
      }
      throw err;
    }
  }

  private out(d: ResourceDef, row: Record<string, unknown>) {
    return d.serialize ? d.serialize(row) : row;
  }

  async list(resource: string) {
    const d = this.def(resource);
    const rows = await this.delegate(this.prisma, d).findMany({
      orderBy: d.orderBy,
      include: d.include,
      take: 1000,
    });
    return rows.map((r) => this.out(d, r));
  }

  /** Splits nested or write-only input into the stored columns. */
  private async columns(
    tx: Db,
    resource: string,
    id: string | null,
    data: Record<string, unknown>,
  ) {
    const { targets, secret, ...cols } = data as Record<string, unknown> & {
      targets?: unknown;
      secret?: string;
    };
    if (resource === 'webhooks' && secret !== undefined && id)
      cols.secretEnc = this.fields.encrypt(secret, webhookSecretAad(id));
    if (resource === 'teams-channels' && typeof cols.url === 'string') {
      // The row id is part of the associated data: a placeholder first, then the real envelope.
      cols.urlEnc = id ? this.fields.encrypt(cols.url, teamsUrlAad(id)) : 'pending';
      delete cols.url;
    }
    // Only one default priority / calendar.
    if ((resource === 'priorities' || resource === 'calendars') && cols.isDefault === true) {
      await this.delegate(tx, this.def(resource)).updateMany({
        where: id ? { NOT: { id } } : {},
        data: { isDefault: false },
      });
    }
    return { cols, targets: targets as Array<Record<string, unknown>> | undefined };
  }

  async create(req: FastifyRequest, resource: string, body: unknown) {
    const d = this.def(resource);
    if (d.fixed) throw new AppError('forbidden');
    const data = this.parse(d.create, body) as Record<string, unknown>;
    const warnings = this.validate(d, data);
    const row = await this.write(async (tx) => {
      const { cols, targets } = await this.columns(tx, resource, null, data);
      let created = await this.delegate(tx, d).create({ data: cols });
      if (resource === 'teams-channels' && data.url) {
        created = await this.delegate(tx, d).update({
          where: { id: created.id },
          data: { urlEnc: this.fields.encrypt(String(data.url), teamsUrlAad(String(created.id))) },
        });
      }
      if (resource === 'webhooks' && data.secret) {
        created = await this.delegate(tx, d).update({
          where: { id: created.id },
          data: {
            secretEnc: this.fields.encrypt(
              String(data.secret),
              webhookSecretAad(String(created.id)),
            ),
          },
        });
      }
      if (targets)
        await tx.slaTarget.createMany({
          data: targets.map((t) => ({
            ...t,
            slaId: String(created.id),
          })) as Prisma.SlaTargetCreateManyInput[],
        });
      await this.record(tx, req, `config.${resource}.created`, String(created.id), {
        after: this.out(d, created),
      });
      return created;
    });
    this.afterWrite(resource);
    return { ...this.out(d, row), warnings };
  }

  async update(req: FastifyRequest, resource: string, id: string, body: unknown) {
    const d = this.def(resource);
    const schema = d.update ?? (d.create instanceof z.ZodObject ? d.create.partial() : d.create);
    const patch = this.parse(schema, body) as Record<string, unknown>;
    const before = await this.delegate(this.prisma, d).findUnique({
      where: { id },
      include: d.include,
    });
    if (!before) throw new AppError('not_found');
    const merged = { ...before, ...patch };
    if (resource === 'slas' && !patch.targets) merged.targets = before.targets;
    const warnings = this.validate(d, merged);
    const row = await this.write(async (tx) => {
      const { cols, targets } = await this.columns(tx, resource, id, patch);
      const updated = await this.delegate(tx, d).update({ where: { id }, data: cols });
      if (targets) {
        await tx.slaTarget.deleteMany({ where: { slaId: id } });
        await tx.slaTarget.createMany({
          data: targets.map((t) => ({ ...t, slaId: id })) as Prisma.SlaTargetCreateManyInput[],
        });
      }
      await this.record(tx, req, `config.${resource}.updated`, id, {
        before: this.out(d, before),
        after: this.out(d, updated),
      });
      return updated;
    });
    this.afterWrite(resource);
    return { ...this.out(d, row), warnings };
  }

  async remove(req: FastifyRequest, resource: string, id: string) {
    const d = this.def(resource);
    if (d.fixed || d.protectedIds?.includes(id))
      throw new AppError('forbidden', 'This record cannot be deleted.');
    const before = await this.delegate(this.prisma, d).findUnique({ where: { id } });
    if (!before) throw new AppError('not_found');
    await this.write(async (tx) => {
      await this.delegate(tx, d).delete({ where: { id } });
      await this.record(tx, req, `config.${resource}.deleted`, id, { before: this.out(d, before) });
    });
    this.afterWrite(resource);
  }

  private async write<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002')
          throw new AppError('conflict', 'A record with the same name already exists.');
        if (err.code === 'P2003')
          throw new AppError('conflict', 'The record is in use; deactivate it instead.');
        if (err.code === 'P2025') throw new AppError('not_found');
      }
      throw err;
    }
  }

  private record(
    tx: Db,
    req: FastifyRequest,
    action: string,
    targetId: string,
    data: Record<string, unknown>,
  ) {
    return this.audit.record(
      { ...AuditService.fromRequest(req), action, targetType: 'config', targetId, data },
      tx,
    );
  }

  private afterWrite(resource: string) {
    if (resource === 'calendars' || resource === 'slas') this.sla.invalidate();
  }
}
