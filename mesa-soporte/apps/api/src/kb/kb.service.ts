import { Injectable } from '@nestjs/common';
import { Permission } from '@mesa/shared';
import { Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { AuthenticatedUser } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { htmlToText, sanitizeHtml } from '../tickets/sanitize';

type Audience = 'editor' | 'agent' | 'customer';

interface TranslationInput {
  title: string;
  body: string;
  keywords: string[];
}

/**
 * Knowledge base for authenticated users only. Customers see published,
 * customer-visible answers whose publication date has passed; agents also see
 * internal answers; editors see drafts and archived answers too.
 */
@Injectable()
export class KbService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  audience(actor: AuthenticatedUser): Audience {
    if (actor.permissions.includes(Permission.KbEdit)) return 'editor';
    if (actor.permissions.includes(Permission.TicketsAgent)) return 'agent';
    return 'customer';
  }

  private visible(actor: AuthenticatedUser, now = new Date()): Prisma.KbAnswerWhereInput {
    const a = this.audience(actor);
    if (a === 'editor') return {};
    const published: Prisma.KbAnswerWhereInput = {
      state: 'published',
      OR: [{ publishAt: null }, { publishAt: { lte: now } }],
    };
    return a === 'agent' ? published : { AND: [published, { visibility: 'customer' }] };
  }

  async categories(actor: AuthenticatedUser) {
    const [cats, counts] = await Promise.all([
      this.prisma.kbCategory.findMany({ orderBy: [{ position: 'asc' }, { slug: 'asc' }] }),
      this.prisma.kbAnswer.groupBy({
        by: ['categoryId'],
        where: this.visible(actor),
        _count: true,
      }),
    ]);
    const n = new Map(counts.map((c) => [c.categoryId, c._count]));
    return cats.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      names: c.names,
      slug: c.slug,
      position: c.position,
      answers: n.get(c.id) ?? 0,
    }));
  }

  async list(actor: AuthenticatedUser, categoryId?: string) {
    const rows = await this.prisma.kbAnswer.findMany({
      where: { AND: [this.visible(actor), categoryId ? { categoryId } : {}] },
      include: { translations: { select: { locale: true, title: true, updatedAt: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.summary(actor, r));
  }

  private summary(
    actor: AuthenticatedUser,
    r: {
      id: string;
      categoryId: string;
      visibility: string;
      state: string;
      publishAt: Date | null;
      updatedAt: Date;
      translations: Array<{ locale: string; title: string }>;
    },
  ) {
    const editor = this.audience(actor) === 'editor';
    return {
      id: r.id,
      categoryId: r.categoryId,
      translations: r.translations.map((t) => ({ locale: t.locale, title: t.title })),
      updatedAt: r.updatedAt,
      ...(this.audience(actor) !== 'customer' ? { visibility: r.visibility } : {}),
      ...(editor ? { state: r.state, publishAt: r.publishAt } : {}),
    };
  }

  async get(actor: AuthenticatedUser, id: string) {
    const r = await this.prisma.kbAnswer.findFirst({
      where: { AND: [{ id }, this.visible(actor)] },
      include: { translations: true, category: true },
    });
    if (!r) throw new AppError('not_found');
    return {
      ...this.summary(actor, r),
      category: { id: r.category.id, names: r.category.names },
      translations: r.translations.map((t) => ({
        locale: t.locale,
        title: t.title,
        bodyHtml: t.bodyHtml,
        keywords: t.keywords,
        version: t.version,
        updatedAt: t.updatedAt,
      })),
    };
  }

  /** Full-text search with the visibility rules applied in SQL. */
  async search(actor: AuthenticatedUser, q: string, locale: string | undefined, limit: number) {
    const text = q.trim().slice(0, 200);
    if (text.length < 2) return [];
    const a = this.audience(actor);
    const editor = a === 'editor';
    const customer = a === 'customer';
    const rows = await this.prisma.$queryRaw<
      Array<{ answer_id: string; locale: string; title: string; snippet: string }>
    >`
      WITH q AS (
        SELECT websearch_to_tsquery('spanish', mesa_unaccent(${text}))
            || websearch_to_tsquery('english', mesa_unaccent(${text}))
            || websearch_to_tsquery('simple', mesa_unaccent(${text})) AS query
      )
      SELECT t.answer_id, t.locale, t.title, left(t.body_text, 240) AS snippet
      FROM kb_translations t
      JOIN kb_answers a ON a.id = t.answer_id, q
      WHERE t.search_vector @@ q.query
        AND (${editor} OR (a.state = 'published' AND (a.publish_at IS NULL OR a.publish_at <= now())))
        AND (NOT ${customer} OR a.visibility = 'customer')
        AND (${locale ?? null}::text IS NULL OR t.locale = ${locale ?? null}::text)
      ORDER BY ts_rank(t.search_vector, q.query) DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.answer_id,
      locale: r.locale,
      title: r.title,
      snippet: r.snippet,
    }));
  }

  // ---------------------------------------------------------------- editors

  async createCategory(
    req: FastifyRequest,
    input: {
      parentId?: string | null;
      names: Record<string, string>;
      slug: string;
      position: number;
    },
  ) {
    if (
      input.parentId &&
      !(await this.prisma.kbCategory.findUnique({ where: { id: input.parentId } }))
    ) {
      throw new AppError('validation_failed', 'Unknown parent.', [
        { path: 'parentId', code: 'invalid' },
      ]);
    }
    const c = await this.prisma.kbCategory
      .create({ data: { ...input, parentId: input.parentId ?? null } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
          throw new AppError('conflict');
        throw err;
      });
    await this.record(req, 'kb.category.created', c.id, { slug: c.slug });
    return c;
  }

  async deleteCategory(req: FastifyRequest, id: string) {
    const used = await this.prisma.kbCategory.findUnique({
      where: { id },
      include: { _count: { select: { answers: true, children: true } } },
    });
    if (!used) throw new AppError('not_found');
    if (used._count.answers || used._count.children)
      throw new AppError('conflict', 'The category is not empty.');
    await this.prisma.kbCategory.delete({ where: { id } });
    await this.record(req, 'kb.category.deleted', id, { slug: used.slug });
  }

  async createAnswer(
    req: FastifyRequest,
    input: {
      categoryId: string;
      visibility: string;
      locale: string;
      translation: TranslationInput;
    },
  ) {
    const actor = req.auth!.user;
    if (!(await this.prisma.kbCategory.findUnique({ where: { id: input.categoryId } }))) {
      throw new AppError('validation_failed', 'Unknown category.', [
        { path: 'categoryId', code: 'invalid' },
      ]);
    }
    const html = sanitizeHtml(input.translation.body);
    const answer = await this.prisma.kbAnswer.create({
      data: {
        categoryId: input.categoryId,
        visibility: input.visibility,
        createdById: actor.id,
        translations: {
          create: {
            locale: input.locale,
            title: input.translation.title,
            bodyHtml: html,
            bodyText: htmlToText(html),
            keywords: input.translation.keywords,
            updatedById: actor.id,
          },
        },
      },
    });
    await this.record(req, 'kb.answer.created', answer.id, { locale: input.locale });
    return this.get(actor, answer.id);
  }

  /** Creates or edits one translation; the previous text is kept as a version. */
  async saveTranslation(req: FastifyRequest, id: string, locale: string, input: TranslationInput) {
    const actor = req.auth!.user;
    const answer = await this.prisma.kbAnswer.findUnique({ where: { id } });
    if (!answer) throw new AppError('not_found');
    const html = sanitizeHtml(input.body);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.kbTranslation.findUnique({
        where: { answerId_locale: { answerId: id, locale } },
      });
      if (!current) {
        await tx.kbTranslation.create({
          data: {
            answerId: id,
            locale,
            title: input.title,
            bodyHtml: html,
            bodyText: htmlToText(html),
            keywords: input.keywords,
            updatedById: actor.id,
          },
        });
        return;
      }
      await tx.kbTranslationVersion.create({
        data: {
          translationId: current.id,
          version: current.version,
          title: current.title,
          bodyHtml: current.bodyHtml,
          editedById: current.updatedById,
        },
      });
      await tx.kbTranslation.update({
        where: { id: current.id },
        data: {
          title: input.title,
          bodyHtml: html,
          bodyText: htmlToText(html),
          keywords: input.keywords,
          version: current.version + 1,
          updatedById: actor.id,
        },
      });
    });
    await this.prisma.kbAnswer.update({ where: { id }, data: { updatedAt: new Date() } });
    await this.record(req, 'kb.translation.saved', id, { locale });
    return this.get(actor, id);
  }

  async versions(id: string, locale: string) {
    const t = await this.prisma.kbTranslation.findUnique({
      where: { answerId_locale: { answerId: id, locale } },
      include: { versions: { orderBy: { version: 'desc' }, take: 100 } },
    });
    if (!t) throw new AppError('not_found');
    return t.versions.map((v) => ({
      version: v.version,
      title: v.title,
      bodyHtml: v.bodyHtml,
      editedById: v.editedById,
      createdAt: v.createdAt,
    }));
  }

  async updateAnswer(
    req: FastifyRequest,
    id: string,
    input: { categoryId?: string; visibility?: string; state?: string; publishAt?: Date | null },
  ) {
    const before = await this.prisma.kbAnswer.findUnique({ where: { id } });
    if (!before) throw new AppError('not_found');
    if (
      input.categoryId &&
      !(await this.prisma.kbCategory.findUnique({ where: { id: input.categoryId } }))
    ) {
      throw new AppError('validation_failed', 'Unknown category.', [
        { path: 'categoryId', code: 'invalid' },
      ]);
    }
    await this.prisma.kbAnswer.update({ where: { id }, data: input });
    if (input.state && input.state !== before.state)
      await this.record(req, `kb.answer.${input.state}`, id, {
        publishAt: input.publishAt ?? before.publishAt,
      });
    else await this.record(req, 'kb.answer.updated', id, { changes: input });
    return this.get(req.auth!.user, id);
  }

  async deleteAnswer(req: FastifyRequest, id: string) {
    const a = await this.prisma.kbAnswer.findUnique({ where: { id } });
    if (!a) throw new AppError('not_found');
    if (a.state === 'published')
      throw new AppError('conflict', 'Archive the answer before deleting it.');
    await this.prisma.kbAnswer.delete({ where: { id } });
    await this.record(req, 'kb.answer.deleted', id, {});
  }

  private record(
    req: FastifyRequest,
    action: string,
    targetId: string,
    data: Record<string, unknown>,
  ) {
    return this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      targetType: 'kb',
      targetId,
      data,
    });
  }
}
