import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Permission, UuidParamSchema } from '@mesa/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { ZodPipe } from '../common/zod-validation.pipe';
import { Area, RequireAnyPermission, RequirePermissions } from '../policy/decorators';
import { detectText } from '../privacy/sensitive';
import { RateLimitService } from '../security/rate-limit.service';
import { AttachmentsService } from './attachments.service';

const SensitiveCheckSchema = z.object({ text: z.string().max(200_000) }).strict();
const Any = () => RequireAnyPermission(Permission.TicketsAgent, Permission.TicketsCustomer);

@Controller()
export class AttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly limits: RateLimitService,
  ) {}

  /** Multipart upload (field "file"); the file stays staged until an article uses it. */
  @Post('attachments')
  @Any()
  async upload(@Req() req: FastifyRequest) {
    const actor = req.auth!.user;
    await this.limits.consume('upload', actor.id);
    if (!req.isMultipart())
      throw new AppError('validation_failed', 'Expected multipart/form-data.');
    const file = await req.file({
      limits: { fileSize: this.attachments.maxBytes, files: 1, fields: 0 },
    });
    if (!file || file.fieldname !== 'file')
      throw new AppError('validation_failed', 'Missing file.');
    const buffer = await file.toBuffer().catch(() => {
      throw new AppError('validation_failed', 'File too large.', [
        { path: 'file', code: 'too_large' },
      ]);
    });
    if (file.file.truncated)
      throw new AppError('validation_failed', 'File too large.', [
        { path: 'file', code: 'too_large' },
      ]);
    return this.attachments.upload(actor, buffer, file.filename);
  }

  @Get('attachments/:id')
  @Any()
  async download(
    @Req() req: FastifyRequest,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    await this.limits.consume('download', req.auth!.user.id);
    return this.attachments.downloadUrl(req, p.id);
  }

  @Get('attachments/:id/inline')
  @Any()
  async inline(
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @Param(new ZodPipe(UuidParamSchema)) p: { id: string },
  ) {
    await this.limits.consume('download', req.auth!.user.id);
    const img = await this.attachments.inlineImage(req.auth!.user, p.id);
    return reply
      .header('Content-Type', img.contentType)
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, max-age=300')
      .header('Content-Disposition', 'inline')
      .send(img.body);
  }

  @Delete('attachments/:id')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async remove(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    await this.attachments.remove(req, p.id);
  }

  @Post('articles/:id/redact')
  @Area('agent')
  @RequirePermissions(Permission.TicketsAgent)
  @HttpCode(204)
  async redact(@Req() req: FastifyRequest, @Param(new ZodPipe(UuidParamSchema)) p: { id: string }) {
    await this.attachments.redactArticle(req, p.id);
  }

  /** Lets the portal warn customers before they send payroll or personal data. */
  @Post('sensitive-check')
  @Any()
  @HttpCode(200)
  async sensitiveCheck(
    @Req() req: FastifyRequest,
    @Body(new ZodPipe(SensitiveCheckSchema)) body: z.infer<typeof SensitiveCheckSchema>,
  ) {
    await this.limits.consume('sensitiveCheck', req.auth!.user.id);
    return { findings: detectText(body.text) };
  }
}
