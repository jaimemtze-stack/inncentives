import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ArticleCreateSchema,
  BulkUpdateSchema,
  ChecklistItemSchema,
  ChecklistItemUpdateSchema,
  LinkSchema,
  MergeSchema,
  Permission,
  PortalTicketCreateSchema,
  SharedDraftSchema,
  SplitSchema,
  TagsSchema,
  TicketCreateSchema,
  TicketListQuerySchema,
  TicketUpdateSchema,
  TimeSpentSchema,
  UuidParamSchema,
} from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { OverviewsService } from '../overviews/overviews.service';
import { Area, RequireAnyPermission, RequirePermissions } from '../policy/decorators';
import { TicketAccessService } from './access.service';
import { TicketExtrasService } from './ticket-extras.service';
import { TicketService } from './ticket.service';
import { FormService } from './form.service';
import { MacrosService } from './macros.service';

const IdItem = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });
const IdTarget = z.object({ id: z.string().uuid(), targetId: z.string().uuid() });
const IdMacro = z.object({ id: z.string().uuid(), macroId: z.string().uuid() });
const SearchQuery = z
  .object({ q: z.string().max(300), limit: z.coerce.number().int().min(1).max(50).default(20) })
  .strict();
const GetQuery = z.object({ open: z.enum(['true', 'false']).optional() }).strict();
const LookupQuery = z.object({ q: z.string().max(100) }).strict();
const Any = () => RequireAnyPermission(Permission.TicketsAgent, Permission.TicketsCustomer);

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return new ZodPipe(schema).transform(value);
}

@Controller()
export class TicketsController {
  constructor(
    private readonly tickets: TicketService,
    private readonly extras: TicketExtrasService,
    private readonly overviews: OverviewsService,
    private readonly access: TicketAccessService,
    private readonly macros: MacrosService,
    private readonly form: FormService,
  ) {}

  // ----------------------------------------------------------------- shared

  @Get('overviews')
  @Any()
  listOverviews(@Req() req: FastifyRequest) {
    return this.overviews.list(req.auth!.user);
  }

  @Get('tickets')
  @Any()
  list(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(TicketListQuerySchema)) q: z.infer<typeof TicketListQuerySchema>,
  ) {
    return this.overviews.tickets(req.auth!.user, q);
  }

  @Post('tickets')
  @Any()
  async create(@Req() req: FastifyRequest, @Body() body: unknown) {
    const actor = req.auth!.user;
    const id = this.access.isStaff(actor)
      ? await this.tickets.createByAgent(actor, parse(TicketCreateSchema, body))
      : await this.tickets.createByCustomer(actor, parse(PortalTicketCreateSchema, body));
    return this.extras.get(actor, id);
  }

  @Get('search')
  @Any()
  search(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(SearchQuery)) q: z.infer<typeof SearchQuery>,
  ) {
    return this.overviews.search(req.auth!.user, q.q, q.limit);
  }

  @Get('tickets/:id')
  @Any()
  get(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Query(new ZodPipe(GetQuery)) q: z.infer<typeof GetQuery>,
  ) {
    return q.open === 'true'
      ? this.extras.open(req.auth!.user, p.id)
      : this.extras.get(req.auth!.user, p.id);
  }

  @Patch('tickets/:id')
  @Any()
  async update(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(TicketUpdateSchema)) body: z.infer<typeof TicketUpdateSchema>,
  ) {
    await this.tickets.updateByUser(req.auth!.user, p.id, body);
    return this.extras.get(req.auth!.user, p.id);
  }

  @Get('tickets/:id/articles')
  @Any()
  articles(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.extras.articles(req.auth!.user, p.id);
  }

  @Post('tickets/:id/articles')
  @Any()
  async addArticle(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(ArticleCreateSchema)) body: z.infer<typeof ArticleCreateSchema>,
  ) {
    return { id: await this.tickets.addArticleByUser(req.auth!.user, p.id, body) };
  }

  // ------------------------------------------------------------- agent only

  @Get('tickets/:id/history')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  history(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.extras.history(req.auth!.user, p.id);
  }

  @Post('tickets/bulk')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  bulk(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(BulkUpdateSchema)) body: z.infer<typeof BulkUpdateSchema>,
  ) {
    return this.macros.bulk(req.auth!.user, body);
  }

  @Post('tickets/:id/tags')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async addTags(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(TagsSchema)) body: z.infer<typeof TagsSchema>,
  ) {
    await this.access.load(req.auth!.user, p.id, 'change');
    await this.tickets.changeTags(p.id, body.tags, [], req.auth!.user.id);
  }

  @Post('tickets/:id/tags/remove')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async removeTags(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(TagsSchema)) body: z.infer<typeof TagsSchema>,
  ) {
    await this.access.load(req.auth!.user, p.id, 'change');
    await this.tickets.changeTags(p.id, [], body.tags, req.auth!.user.id);
  }

  @Post('tickets/:id/merge')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async merge(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(MergeSchema)) body: z.infer<typeof MergeSchema>,
  ) {
    await this.tickets.merge(req.auth!.user, p.id, body.targetId);
  }

  @Post('tickets/:id/split')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  async split(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(SplitSchema)) body: z.infer<typeof SplitSchema>,
  ) {
    return { id: await this.tickets.split(req.auth!.user, p.id, body.articleId, body.title) };
  }

  @Get('tickets/:id/links')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  links(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.extras.links(req.auth!.user, p.id);
  }

  @Post('tickets/:id/links')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async addLink(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(LinkSchema)) body: z.infer<typeof LinkSchema>,
  ) {
    await this.extras.addLink(req.auth!.user, p.id, body.targetId, body.type);
  }

  @Delete('tickets/:id/links/:targetId')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async removeLink(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(IdTarget)) p: z.infer<typeof IdTarget>,
  ) {
    await this.extras.removeLink(req.auth!.user, p.id, p.targetId);
  }

  @Get('tickets/:id/checklist')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  checklist(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.extras.checklist(req.auth!.user, p.id);
  }

  @Post('tickets/:id/checklist')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  addChecklistItem(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(ChecklistItemSchema)) body: z.infer<typeof ChecklistItemSchema>,
  ) {
    return this.extras.addChecklistItem(req.auth!.user, p.id, body.text);
  }

  @Patch('tickets/:id/checklist/:itemId')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async updateChecklistItem(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(IdItem)) p: z.infer<typeof IdItem>,
    @Body(new ZodPipe(ChecklistItemUpdateSchema)) body: z.infer<typeof ChecklistItemUpdateSchema>,
  ) {
    await this.extras.updateChecklistItem(req.auth!.user, p.id, p.itemId, body);
  }

  @Delete('tickets/:id/checklist/:itemId')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async deleteChecklistItem(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(IdItem)) p: z.infer<typeof IdItem>,
  ) {
    await this.extras.deleteChecklistItem(req.auth!.user, p.id, p.itemId);
  }

  @Get('tickets/:id/time-entries')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  timeEntries(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.extras.timeEntries(req.auth!.user, p.id);
  }

  @Post('tickets/:id/time-entries')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async addTimeEntry(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(TimeSpentSchema)) body: z.infer<typeof TimeSpentSchema>,
  ) {
    await this.extras.addTimeEntry(req.auth!.user, p.id, body);
  }

  @Put('tickets/:id/subscription')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async subscribe(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    await this.extras.subscribe(req.auth!.user, p.id, true);
  }

  @Delete('tickets/:id/subscription')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async unsubscribe(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    await this.extras.subscribe(req.auth!.user, p.id, false);
  }

  @Get('tickets/:id/draft')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  draft(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.extras.draft(req.auth!.user, p.id);
  }

  @Put('tickets/:id/draft')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async saveDraft(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(SharedDraftSchema)) body: z.infer<typeof SharedDraftSchema>,
  ) {
    await this.extras.saveDraft(req.auth!.user, p.id, body.body, body.meta);
  }

  @Delete('tickets/:id/draft')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async deleteDraft(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    await this.extras.deleteDraft(req.auth!.user, p.id);
  }

  @Post('tickets/:id/macros/:macroId')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  async applyMacro(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(IdMacro)) p: z.infer<typeof IdMacro>,
  ) {
    await this.macros.apply(req.auth!.user, p.id, p.macroId);
    return this.extras.get(req.auth!.user, p.id);
  }

  @Get('ticket-form')
  @Any()
  formMeta(@Req() req: FastifyRequest) {
    return this.form.formMeta(req.auth!.user);
  }

  @Get('lookup/customers')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  customers(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(LookupQuery)) q: z.infer<typeof LookupQuery>,
  ) {
    return this.form.searchCustomers(req.auth!.user, q.q);
  }

  @Post('ticket-form/evaluate')
  @Any()
  evaluate(@Req() req: FastifyRequest, @Body() body: unknown) {
    if (!body || typeof body !== 'object') throw new AppError('validation_failed');
    return this.form.evaluateForm(req.auth!.user, body);
  }
}
