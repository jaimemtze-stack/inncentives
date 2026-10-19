# syntax=docker/dockerfile:1.7
# Multi-arch (linux/amd64, linux/arm64) images for the API, the worker and the
# web assets. Build one target at a time:
#   docker buildx build -f docker/app.Dockerfile --target api .
# Base images pinned by digest (multi-arch index); Renovate/Dependabot bump them.
ARG NODE_BUILD_IMAGE=node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94
ARG NODE_RUNTIME_IMAGE=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:ec2313763dd43931543bd03830466e0c409ce73a487e8d46f10db72d3b816c1c

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
    export NODE_EXTRA_CA_CERTS=/run/secrets/ca \
 && pnpm --filter @mesa/shared build \
 && pnpm --filter @mesa/api build \
 && pnpm --filter @mesa/worker build \
 && pnpm --filter @mesa/web build
# Production-only dependency trees for each service. The base image has no
# OpenSSL binary, so Prisma cannot detect the platform: name the engine target
# explicitly (PRISMA_CLI_BINARY_TARGETS) for the architecture being built.
ARG TARGETARCH
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    set -eu; \
    case "$TARGETARCH" in arm64) keep=linux-arm64-openssl-3.0.x ;; *) keep=debian-openssl-3.0.x ;; esac; \
    export NODE_EXTRA_CA_CERTS=/run/secrets/ca PRISMA_CLI_BINARY_TARGETS="$keep"; \
    pnpm --filter @mesa/api deploy --prod --legacy /out/api; \
    pnpm --filter @mesa/worker deploy --prod --legacy /out/worker; \
    cd /out/api && node node_modules/prisma/build/index.js generate >/dev/null; \
    rm -rf /out/api/src /out/api/test /out/worker/src; \
    find /out/api/node_modules -name 'libquery_engine-*.so.node' ! -name "*${keep}*" -delete; \
    # Migrator: Prisma CLI + the schema engine of this architecture only.
    cp -a /out/api /out/migrator; \
    cp "$(find /out/migrator/node_modules/.pnpm -path "*@prisma/engines/schema-engine-$keep" | head -1)" /out/migrator/schema-engine; \
    find /out/migrator/node_modules/.pnpm -path '*@prisma/engines/schema-engine-*' -delete; \
    # API: no Prisma CLI, engines package, TypeScript or migrations.
    rm -rf /out/api/node_modules/prisma /out/api/node_modules/.bin \
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
ENV NODE_ENV=production \
    PRISMA_SCHEMA_ENGINE_BINARY=/app/schema-engine \
    PRISMA_HIDE_UPDATE_MESSAGE=1
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
# Static assets served by nginx-unprivileged (uid 101), which also proxies the
# API (see docker/nginx/default.conf).
FROM nginxinc/nginx-unprivileged:1.31.7-alpine3.24@sha256:378d0c32f6562f7fd9629170797f57d2b953aa09be983b3daaf4809bb039ca00 AS web
# Security fixes released after the pinned base image (e.g. libexpat CVE-2026-77214).
USER root
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then cp /run/secrets/ca /tmp/ca.crt; export SSL_CERT_FILE=/tmp/ca.crt; fi; \
    apk upgrade --no-cache && rm -f /tmp/ca.crt
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER 101:101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/"]
