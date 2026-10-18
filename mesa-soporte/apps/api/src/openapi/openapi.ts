import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ZodPipe } from '../common/zod-validation.pipe';
import { API_BODY_KEY } from './api-body';
import {
  ANY_PERMISSIONS_KEY,
  AREA_KEY,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  REAUTH_KEY,
} from '../policy/decorators';

const PREFIX = '/api/v1';
const UNPREFIXED = new Set(['/health', '/ready', '/hooks/cti', '/hooks/azure-devops']);

type Json = Record<string, unknown>;

interface RouteArg {
  index: number;
  data?: string;
  pipes?: unknown[];
}

const schemaOf = (pipes: unknown[] = []): ZodTypeAny | undefined =>
  pipes.find((p): p is ZodPipe<ZodTypeAny> => p instanceof ZodPipe)?.schema;

const toJson = (s: ZodTypeAny): Json => {
  // The cast avoids TypeScript instantiating the generic over our large schemas.
  const convert = zodToJsonSchema as unknown as (s: unknown, o: unknown) => Json;
  const out = convert(s, { $refStrategy: 'none' });
  delete out.$schema;
  return out;
};

const join = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .join('/');

/** "tickets/:id" -> "tickets/{id}". */
const openapiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

function meta<T>(key: string, handler: object, controller: object): T | undefined {
  return (
    (Reflect.getMetadata(key, handler) as T | undefined) ?? Reflect.getMetadata(key, controller)
  );
}

/**
 * OpenAPI 3.1 description built from the Nest route metadata: paths, verbs,
 * Zod-validated parameters and bodies, and the authorization each route
 * requires (x-permissions, x-area, x-reauth). Response bodies are not
 * described; error responses follow the common error envelope.
 */
export function buildOpenApi(
  controllers: Array<new (...args: never[]) => unknown>,
  version: string,
) {
  const paths: Record<string, Record<string, Json>> = {};
  for (const ctrl of controllers) {
    const base = (Reflect.getMetadata(PATH_METADATA, ctrl) as string | string[] | undefined) ?? '';
    const proto = ctrl.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      if (method === undefined || sub === undefined) continue;
      const verb = RequestMethod[method].toLowerCase();
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(verb)) continue;

      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {}) as Record<
        string,
        RouteArg
      >;
      const parameters: Json[] = [];
      let requestBody: Json | undefined;
      for (const [key, arg] of Object.entries(args)) {
        const type = Number(key.split(':')[0]);
        const schema = schemaOf(arg.pipes);
        if (type === RouteParamtypes.BODY && schema) {
          requestBody = {
            required: true,
            content: { 'application/json': { schema: toJson(schema) } },
          };
        } else if ((type === RouteParamtypes.QUERY || type === RouteParamtypes.PARAM) && schema) {
          const s = toJson(schema) as { properties?: Record<string, Json>; required?: string[] };
          for (const [prop, ps] of Object.entries(s.properties ?? {})) {
            parameters.push({
              name: prop,
              in: type === RouteParamtypes.QUERY ? 'query' : 'path',
              required: type === RouteParamtypes.PARAM || (s.required ?? []).includes(prop),
              schema: ps,
            });
          }
        }
      }

      const documented = Reflect.getMetadata(API_BODY_KEY, handler) as ZodTypeAny[] | undefined;
      if (!requestBody && documented?.length) {
        const schemas = documented.map(toJson);
        requestBody = {
          required: true,
          content: {
            'application/json': { schema: schemas.length === 1 ? schemas[0] : { oneOf: schemas } },
          },
        };
      }

      const bases = Array.isArray(base) ? base : [base];
      const subs = Array.isArray(sub) ? sub : [sub];
      for (const b of bases) {
        for (const s of subs) {
          const raw = join(b, s);
          const full = UNPREFIXED.has(raw) ? raw : join(PREFIX, raw);
          const isPublic = meta<boolean>(PUBLIC_KEY, handler, ctrl) === true;
          // Path parameters without a Zod schema (rare) are still declared.
          for (const m of raw.matchAll(/:([A-Za-z0-9_]+)/g)) {
            if (!parameters.some((p) => p.in === 'path' && p.name === m[1]))
              parameters.push({
                name: m[1],
                in: 'path',
                required: true,
                schema: { type: 'string' },
              });
          }
          const op: Json = {
            operationId: `${ctrl.name.replace(/Controller$/, '')}_${name}`,
            tags: [ctrl.name.replace(/Controller$/, '')],
            ...(parameters.length ? { parameters } : {}),
            ...(requestBody ? { requestBody } : {}),
            responses: {
              default: {
                description: 'Error',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              },
              '2XX': { description: 'OK' },
            },
            security: isPublic ? [] : [{ session: [] }, { bearer: [] }],
            'x-area': meta<string>(AREA_KEY, handler, ctrl) ?? 'any',
          };
          const all = meta<string[]>(PERMISSIONS_KEY, handler, ctrl);
          const any = meta<string[]>(ANY_PERMISSIONS_KEY, handler, ctrl);
          if (all?.length) op['x-permissions'] = { all };
          if (any?.length) op['x-permissions'] = { ...(op['x-permissions'] as Json), any };
          if (meta<boolean>(REAUTH_KEY, handler, ctrl)) op['x-reauth'] = true;
          (paths[openapiPath(full)] ??= {})[verb] = op;
        }
      }
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Mesa de soporte Inncentives API',
      version,
      description:
        'Generated from the route metadata. Writes with a session cookie need the X-CSRF-Token header; integrations use API tokens (Bearer mesa_…).',
    },
    servers: [{ url: '/' }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: '__Host-sid' },
        bearer: { type: 'http', scheme: 'bearer', description: 'API token (mesa_…)' },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                correlationId: { type: 'string' },
                details: { type: 'array', items: { type: 'object' } },
              },
            },
          },
        },
      },
    },
  };
}
