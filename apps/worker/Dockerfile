FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

RUN corepack enable

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile --filter @diffguard/worker...
RUN DATABASE_URL=postgresql://diffguard@localhost:5432/diffguard pnpm --filter @diffguard/database exec prisma generate

FROM base AS runner

ENV NODE_ENV=production
ENV REDIS_URL=redis://redis:6379
ENV WORKER_HEALTH_PORT=3002

COPY --from=deps /app /app

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.WORKER_HEALTH_PORT || '3002') + '/ready').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["pnpm", "--filter", "@diffguard/worker", "exec", "tsx", "src/index.ts"]
