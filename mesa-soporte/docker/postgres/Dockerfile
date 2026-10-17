# syntax=docker/dockerfile:1.7
# PostgreSQL 16 + pgBackRest + age on Ubuntu 24.04 (multi-arch). pgBackRest
# must live next to PostgreSQL because archive_command runs inside it.
FROM ubuntu:24.04
ARG DEBIAN_FRONTEND=noninteractive
# The optional "ca" secret is only used when building behind a TLS-inspecting proxy.
RUN --mount=type=secret,id=ca,required=false \
    set -eu; APT_OPTS=""; \
    if [ -s /run/secrets/ca ]; then \
      sed -i 's#http://#https://#g' /etc/apt/sources.list.d/ubuntu.sources; \
      install -m 0644 /run/secrets/ca /tmp/build-ca.crt; \
      APT_OPTS="-o Acquire::https::CAInfo=/tmp/build-ca.crt"; \
      if [ -n "${https_proxy:-}" ]; then APT_OPTS="$APT_OPTS -o Acquire::https::Proxy=${https_proxy}"; fi; \
    fi; \
    apt-get $APT_OPTS update; \
    apt-get $APT_OPTS install -y --no-install-recommends \
      postgresql-16 pgbackrest age openssl ca-certificates tzdata; \
    rm -rf /var/lib/apt/lists/* /tmp/build-ca.crt; \
    sed -i 's#https://#http://#g' /etc/apt/sources.list.d/ubuntu.sources; \
    install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/data /var/log/pgbackrest /var/spool/pgbackrest /etc/pgbackrest; \
    install -d -o postgres -g postgres -m 2775 /var/run/postgresql
ENV PATH=/usr/lib/postgresql/16/bin:$PATH \
    PGDATA=/var/lib/postgresql/data \
    LANG=C.UTF-8 \
    TZ=UTC
COPY --chmod=0755 entrypoint.sh /usr/local/bin/mesa-postgres-entrypoint
COPY --chmod=0755 pgbackrest-render.sh /usr/local/bin/pgbackrest-render
COPY --chmod=0755 pgbackrest-restore.sh /usr/local/bin/pgbackrest-restore
STOPSIGNAL SIGINT
EXPOSE 5432
HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD ["setpriv", "--reuid=postgres", "--regid=postgres", "--init-groups", "pg_isready", "-q", "-h", "/var/run/postgresql"]
ENTRYPOINT ["/usr/local/bin/mesa-postgres-entrypoint"]
