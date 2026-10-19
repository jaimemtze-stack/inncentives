import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { Permission } from '@mesa/shared';
import { RequireAnyPermission } from '../policy/decorators';
import { buildOpenApi } from './openapi';

const API_VERSION = '2.0.0';

@Controller()
export class OpenApiController {
  private doc?: ReturnType<typeof buildOpenApi>;

  constructor(private readonly discovery: DiscoveryService) {}

  /** API description for integrators (staff and API tokens of staff accounts). */
  @Get('openapi.json')
  @RequireAnyPermission(Permission.TicketsAgent)
  openapi() {
    this.doc ??= buildOpenApi(
      this.discovery
        .getControllers()
        .map((w) => w.metatype as (new (...args: never[]) => unknown) | null)
        .filter((m): m is new (...args: never[]) => unknown => !!m),
      API_VERSION,
    );
    return this.doc;
  }
}

@Module({ imports: [DiscoveryModule], controllers: [OpenApiController] })
export class OpenApiModule {}
