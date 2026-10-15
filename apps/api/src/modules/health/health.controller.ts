import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { AnyHost, AreaOnly, Public } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';

/** Liveness and readiness probes (outside /api/v1, no auth, no sensitive detail). */
@Controller()
@AreaOnly('any')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  @Public()
  @AnyHost()
  health() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @AnyHost()
  async ready() {
    const checks = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
    const [db, redis] = checks.map((c) => c.status === 'fulfilled');
    if (!db || !redis) throw new ServiceUnavailableException({ status: 'unavailable', db, redis });
    return { status: 'ready', db, redis };
  }
}
