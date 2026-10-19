import { Injectable } from '@nestjs/common';
import { EmailSchema, Roles, type Role } from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { PolicyService } from '../policy/policy.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';
import { csvRecords } from './csv';

export interface ImportReport {
  dryRun: boolean;
  total: number;
  valid: number;
  created: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

const Domain = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
const bool = (v: string | undefined) => /^(1|true|s[ií]|yes|x)$/i.test(v ?? '');

/**
 * CSV import of organizations and users with a validation pass first. Users
 * are provisioned through invitations (no account exists until the person
 * accepts), exactly as when they are invited one by one.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  private records(csv: string) {
    try {
      return csvRecords(csv, 5000);
    } catch (err) {
      throw new AppError('validation_failed', (err as Error).message);
    }
  }

  /** Columns: nombre/name, dominios/domains ("|" separated), plan, mfa. */
  async organizations(req: FastifyRequest, csv: string, dryRun: boolean): Promise<ImportReport> {
    const rows = this.records(csv);
    const plans = new Map(
      (await this.prisma.supportPlan.findMany()).map((p) => [p.name.toLowerCase(), p.id]),
    );
    const existing = new Set(
      (await this.prisma.organization.findMany({ select: { name: true } })).map((o) =>
        o.name.toLowerCase(),
      ),
    );
    const report: ImportReport = { dryRun, total: rows.length, valid: 0, created: 0, errors: [] };
    const valid: Array<{
      name: string;
      domains: string[];
      supportPlanId: string | null;
      mfaRequiredForCustomers: boolean;
    }> = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const row = i + 2;
      const name = r.nombre ?? r.name ?? '';
      const domains = (r.dominios ?? r.domains ?? '')
        .split(/[|\s]+/)
        .map((d) => d.toLowerCase())
        .filter(Boolean);
      const plan = r.plan ?? '';
      const errs: ImportReport['errors'] = [];
      if (!name || name.length > 160)
        errs.push({ row, field: 'nombre', message: 'required (max 160)' });
      else if (existing.has(name.toLowerCase()) || seen.has(name.toLowerCase()))
        errs.push({ row, field: 'nombre', message: 'already exists' });
      for (const d of domains)
        if (!Domain.safeParse(d).success)
          errs.push({ row, field: 'dominios', message: `invalid domain ${d.slice(0, 60)}` });
      if (plan && !plans.has(plan.toLowerCase()))
        errs.push({ row, field: 'plan', message: 'unknown support plan' });
      if (errs.length) report.errors.push(...errs);
      else {
        seen.add(name.toLowerCase());
        valid.push({
          name,
          domains: domains.slice(0, 20),
          supportPlanId: plan ? plans.get(plan.toLowerCase())! : null,
          mfaRequiredForCustomers: bool(r.mfa),
        });
      }
    });
    report.valid = valid.length;
    if (!dryRun && !report.errors.length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.organization.createMany({ data: valid.map((v) => ({ ...v, isInternal: false })) });
        await this.audit.record(
          {
            ...AuditService.fromRequest(req),
            action: 'admin.import.organizations',
            data: { count: valid.length },
          },
          tx,
        );
      });
      report.created = valid.length;
    }
    return report;
  }

  /** Columns: correo/email, nombre/name, organizacion/organization, rol/role (default CUSTOMER). */
  async users(req: FastifyRequest, csv: string, dryRun: boolean): Promise<ImportReport> {
    const actor = req.auth!.user;
    const rows = this.records(csv);
    const orgs = new Map(
      (
        await this.prisma.organization.findMany({
          where: { AND: [{ active: true }, this.policy.organizationScope(actor)] },
        })
      ).map((o) => [o.name.toLowerCase(), o]),
    );
    const report: ImportReport = { dryRun, total: rows.length, valid: 0, created: 0, errors: [] };
    const valid: Array<{ email: string; name: string; role: Role; organizationId: string }> = [];
    const seen = new Set<string>();
    for (const [i, r] of rows.entries()) {
      const row = i + 2;
      const email = EmailSchema.safeParse(r.correo ?? r.email ?? '');
      const name = r.nombre ?? r.name ?? '';
      const role = ((r.rol ?? r.role ?? 'CUSTOMER').toUpperCase() || 'CUSTOMER') as Role;
      const org = orgs.get(
        (r.organizacion ?? r.organización ?? r.organization ?? '').toLowerCase(),
      );
      const errs: ImportReport['errors'] = [];
      if (!email.success) errs.push({ row, field: 'correo', message: 'invalid e-mail' });
      else if (
        seen.has(email.data) ||
        (await this.prisma.user.findUnique({ where: { email: email.data } }))
      ) {
        errs.push({ row, field: 'correo', message: 'already exists' });
      }
      if (!name || name.length > 120)
        errs.push({ row, field: 'nombre', message: 'required (max 120)' });
      if (!(Roles as readonly string[]).includes(role))
        errs.push({ row, field: 'rol', message: 'unknown role' });
      if (!org) errs.push({ row, field: 'organizacion', message: 'unknown organization' });
      else if (
        (Roles as readonly string[]).includes(role) &&
        !this.policy.canInvite(actor, role, org)
      ) {
        errs.push({
          row,
          field: 'rol',
          message: 'not allowed for this organization or your permissions',
        });
      }
      if (errs.length) report.errors.push(...errs);
      else {
        seen.add(email.data!);
        valid.push({ email: email.data!, name, role, organizationId: org!.id });
      }
    }
    report.valid = valid.length;
    if (!dryRun && !report.errors.length) {
      for (const v of valid) await this.admin.createInvitation(req, v);
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'admin.import.users',
        data: { count: valid.length },
      });
      report.created = valid.length;
    }
    return report;
  }
}
