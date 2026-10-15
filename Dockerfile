# syntax=docker/dockerfile:1.7
# Multi-stage build for api, worker and web. Targets: api, worker, web.
FROM node:22.11-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm --filter @inn/shared build \
 && pnpm --filter @inn/api exec prisma generate \
 && pnpm --filter @inn/api build \
 && pnpm --filter @inn/worker build \
 && pnpm --filter @inn/web build \
 && pnpm deploy --filter @inn/api --prod --legacy /out/api \
 && pnpm deploy --filter @inn/worker --prod --legacy /out/worker \
 && cp -r apps/api/dist apps/api/prisma /out/api/ \
 && cp -r apps/worker/dist /out/worker/ \
 && cd /out/api && npx prisma@5.22.0 generate --schema prisma/schema.prisma

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS api
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /out/api /app
ENV NODE_ENV=production
USER nonroot
EXPOSE 3000
CMD ["dist/src/main.js"]

# One-shot migration job (uses the build stage, which has the Prisma CLI).
FROM build AS migrate
WORKDIR /repo/apps/api
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS worker
WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /out/worker /app
ENV NODE_ENV=production
USER nonroot
CMD ["dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
