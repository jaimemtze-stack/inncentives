import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type Redis from 'ioredis';
import { Public } from '../policy/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up. */
  @Get('health')
  @Public()
  @HttpCode(200)
  health() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies answer. No details leak in the body. */
  @Get('ready')
  @Public()
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const checks = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
    const ok = checks.every((c) => c.status === 'fulfilled');
    void reply.status(ok ? 200 : 503);
    return { status: ok ? 'ready' : 'unavailable' };
  }
}
