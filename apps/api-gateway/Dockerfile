# syntax=docker/dockerfile:1.7
# Multi-stage build for the api-gateway.
# Uses pnpm via corepack and builds only what api-gateway needs.

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /repo

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json apps/api-gateway/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api-gateway apps/api-gateway
RUN pnpm --filter @fluentops/shared build \
 && pnpm --filter api-gateway prisma:generate \
 && pnpm --filter api-gateway build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && \
    apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /repo/package.json /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/apps/api-gateway/package.json apps/api-gateway/
COPY --from=build /repo/packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/apps/api-gateway/dist apps/api-gateway/dist
COPY --from=build /repo/apps/api-gateway/prisma apps/api-gateway/prisma
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/api-gateway/node_modules apps/api-gateway/node_modules
COPY --from=build /repo/packages/shared/node_modules packages/shared/node_modules

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/health || exit 1

USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api-gateway/dist/main.js"]
