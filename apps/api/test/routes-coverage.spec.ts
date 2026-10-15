import { RequestMethod } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IS_PUBLIC, PERMISSIONS } from '../src/common/auth/decorators';
import { createTestContext, type TestContext } from './helpers';

/**
 * ADR-0002: every route must declare its access policy. This test walks all registered
 * controllers and fails if any handler has neither @Public nor @RequirePermission/@Authenticated.
 */
describe('route policy coverage', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it('every handler declares @Public or a permission', () => {
    const discovery = ctx.app.get(DiscoveryService);
    const scanner = ctx.app.get(MetadataScanner);
    const reflector = ctx.app.get(Reflector);
    const undeclared: string[] = [];
    let routes = 0;
    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as (...a: unknown[]) => unknown;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        routes++;
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
          handler,
          wrapper.metatype as never,
        ]);
        const perms = reflector.getAllAndOverride<string[]>(PERMISSIONS, [
          handler,
          wrapper.metatype as never,
        ]);
        if (!isPublic && !(perms && perms.length)) {
          const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
          undeclared.push(
            `${method} ${String(Reflect.getMetadata(PATH_METADATA, wrapper.metatype as object))}/${String(Reflect.getMetadata(PATH_METADATA, handler))} (${wrapper.name}.${name})`,
          );
        }
      }
    }
    expect(routes).toBeGreaterThan(10);
    expect(undeclared).toEqual([]);
  });
});
