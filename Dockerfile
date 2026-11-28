# Container images of the shop (#56), the same for every host:
#   web   — the storefront and admin (Next.js standalone server, port 3000)
#   tasks — migrations, the background worker, backups and restore checks
# Configuration comes only from the environment at run time (see
# .env.example); nothing secret is baked into an image.
#   docker build --target web -t auto-shop-web .
#   docker build --target tasks -t auto-shop-tasks .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone NODE_ENV=production
RUN npm run build

FROM ${NODE_IMAGE} AS web
LABEL auto-shop.image=web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
# Liveness only: a database outage must not restart healthy instances.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health?probe=live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]

# Production packages only, for the tasks image. The compiler binaries
# (@next/swc) and image library (@img) are only needed to build and serve.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && rm -rf node_modules/@next/swc-* node_modules/@img \
  && npm cache clean --force

FROM ${NODE_IMAGE} AS tasks
LABEL auto-shop.image=tasks
# pg_dump/pg_restore must be at least the server's version (PostgreSQL 17);
# rclone copies backups off the server (BACKUP_REMOTE).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
     | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
     > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 rclone \
  && apt-get purge -y gnupg && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node db ./db
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src ./src
# A volume mounted here starts out owned by the app user.
RUN install -d -o node -g node /backups \
  && install -d -o node -g node /home/node/.config/rclone \
  && install -o node -g node -m 600 /dev/null /home/node/.config/rclone/rclone.conf
USER node
# Default: the background worker. Migrations, backups and the restore check
# run the scripts in scripts/ (docs/operations/runbook.md).
CMD ["node", "--import", "tsx", "scripts/worker.ts"]
