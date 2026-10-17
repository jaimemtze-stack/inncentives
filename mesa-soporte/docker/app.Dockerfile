# syntax=docker/dockerfile:1.7
# Multi-arch (linux/amd64, linux/arm64) images for the API, the worker and the
# web assets. Build one target at a time:
#   docker buildx build -f docker/app.Dockerfile --target api .
ARG NODE_BUILD_IMAGE=node:22.22.0-bookworm-slim
ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian12:nonroot

FROM ${NODE_BUILD_IMAGE} AS build
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
# The optional "ca" secret only exists when building behind a TLS-inspecting proxy.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm --filter @mesa/shared build \
 && pnpm --filter @mesa/api build \
 && pnpm --filter @mesa/worker build \
 && pnpm --filter @mesa/web build
# Production-only dependency trees for each service.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm --filter @mesa/api deploy --prod --legacy /out/api \
 && NODE_EXTRA_CA_CERTS=/run/secrets/ca pnpm --filter @mesa/worker deploy --prod --legacy /out/worker \
 && cd /out/api && NODE_EXTRA_CA_CERTS=/run/secrets/ca node node_modules/prisma/build/index.js generate \
 && rm -rf /out/api/src /out/api/test /out/worker/src
# Keep only the Prisma query engine of the target architecture. The migrator
# keeps the Prisma CLI; the API image drops it (and its tooling) entirely.
ARG TARGETARCH
RUN case "$TARGETARCH" in arm64) keep=linux-arm64-openssl-3.0.x ;; *) keep=debian-openssl-3.0.x ;; esac \
 && find /out/api/node_modules -name 'libquery_engine-*.so.node' ! -name "*${keep}*" -delete \
 && cp -a /out/api /out/migrator \
 && rm -rf /out/api/node_modules/prisma /out/api/node_modules/.bin \
           /out/api/node_modules/.pnpm/prisma@* /out/api/node_modules/.pnpm/@prisma+engines@* \
           /out/api/node_modules/.pnpm/typescript@* /out/api/node_modules/.pnpm/effect@* \
           /out/api/prisma/migrations

# ---------------------------------------------------------------------- api
FROM ${NODE_RUNTIME_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api /app
USER nonroot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["--enable-source-maps", "dist/main.js"]

# ---------------------------------------------------------------- migrator
# Runs `prisma migrate deploy` with the migration role, then exits.
FROM ${NODE_RUNTIME_IMAGE} AS migrator
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/migrator /app
USER nonroot
CMD ["node_modules/prisma/build/index.js", "migrate", "deploy"]

# ------------------------------------------------------------------- worker
FROM ${NODE_RUNTIME_IMAGE} AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/worker /app
USER nonroot
CMD ["--enable-source-maps", "dist/main.js"]

# ---------------------------------------------------------------------- web
# Static assets served by Caddy (see docker/caddy/Caddyfile).
FROM caddy:2.10.2-alpine AS web
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
RUN addgroup -S -g 10001 web && adduser -S -u 10001 -G web -H web \
 && mkdir -p /data /config && chown -R web:web /data /config
USER 10001:10001
EXPOSE 8080
