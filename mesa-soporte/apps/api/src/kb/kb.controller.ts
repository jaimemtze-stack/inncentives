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
  KbAnswerCreateSchema,
  KbAnswerUpdateSchema,
  KbCategorySchema,
  KbLocales,
  KbTranslationSchema,
  Permission,
  UuidParamSchema,
} from '@mesa/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod-validation.pipe';
import { Area, RequireAnyPermission, RequirePermissions } from '../policy/decorators';
import { KbService } from './kb.service';

const Any = () => RequireAnyPermission(Permission.TicketsAgent, Permission.TicketsCustomer);
const ListQuery = z.object({ categoryId: z.string().uuid().optional() }).strict();
const SearchQuery = z
  .object({
    q: z.string().max(200),
    locale: z.enum(KbLocales).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const LocaleParam = z.object({ id: z.string().uuid(), locale: z.enum(KbLocales) });

/** Knowledge base: authenticated users only (portal and agents), never public. */
@Controller('kb')
export class KbController {
  constructor(private readonly kb: KbService) {}

  @Get('categories')
  @Any()
  categories(@Req() req: FastifyRequest) {
    return this.kb.categories(req.auth!.user);
  }

  @Get('answers')
  @Any()
  list(@Req() req: FastifyRequest, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.kb.list(req.auth!.user, q.categoryId);
  }

  @Get('search')
  @Any()
  search(
    @Req() req: FastifyRequest,
    @Query(new ZodPipe(SearchQuery)) q: z.infer<typeof SearchQuery>,
  ) {
    return this.kb.search(req.auth!.user, q.q, q.locale, q.limit);
  }

  @Get('answers/:id')
  @Any()
  get(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    return this.kb.get(req.auth!.user, p.id);
  }

  // ---------------------------------------------------------------- editors

  @Post('categories')
  @Area('agent')
  @RequirePermissions(Permission.KbEdit)
  createCategory(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(KbCategorySchema)) body: z.infer<typeof KbCategorySchema>,
  ) {
    return this.kb.createCategory(req, body);
  }

  @Delete('categories/:id')
  @Area('agent')
  @RequirePermissions(Permission.KbEdit)
  @HttpCode(204)
  async deleteCategory(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    await this.kb.deleteCategory(req, p.id);
  }

  @Post('answers')
  @Area('agent')
  @RequirePermissions(Permission.KbEdit)
  create(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(KbAnswerCreateSchema)) body: z.infer<typeof KbAnswerCreateSchema>,
  ) {
    return this.kb.createAnswer(req, body);
  }

  @Patch('answers/:id')
  @Area('agent')
  @RequirePermissions(Permission.KbEdit)
  update(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
    @Body(new ZodPipe(KbAnswerUpdateSchema)) body: z.infer<typeof KbAnswerUpdateSchema>,
  ) {
    return this.kb.updateAnswer(req, p.id, body);
  }

  @Put('answers/:id/translations/:locale')
  @Area('agent')
  @RequirePermissions(Permission.KbEdit)
  saveTranslation(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(LocaleParam)) p: z.infer<typeof LocaleParam>,
    @Body(new ZodPipe(KbTranslationSchema)) body: z.infer<typeof KbTranslationSchema>,
  ) {
    return this.kb.saveTranslation(req, p.id, p.locale, body);
  }

  @Get('answers/:id/translations/:locale/versions')
  @Area('agent')
  @RequirePermissions(Permission.KbEdit)
  versions(@Param(new ZodPipe(LocaleParam)) p: z.infer<typeof LocaleParam>) {
    return this.kb.versions(p.id, p.locale);
  }

  @Delete('answers/:id')
  @Area('agent')
  @RequirePermissions(Permission.KbEdit)
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    await this.kb.deleteAnswer(req, p.id);
  }
}
