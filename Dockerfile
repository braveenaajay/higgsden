# syntax=docker/dockerfile:1.7
# One build for every Node service. Pick a service with --target: api, worker, migrate, web.

FROM node:22-bookworm-slim AS base
RUN npm install -g pnpm@9.15.0
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/policy/package.json packages/policy/
COPY packages/domain/package.json packages/domain/
COPY packages/integrations/package.json packages/integrations/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
RUN pnpm build

FROM base AS node-runtime
ENV NODE_ENV=production
COPY --from=build /app /app
USER node

FROM node-runtime AS api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM node-runtime AS worker
WORKDIR /app/apps/worker
CMD ["node", "dist/main.js"]

FROM node-runtime AS migrate
WORKDIR /app/packages/db
CMD ["sh", "-c", "node dist/migrate.js && node dist/seed.js"]

FROM nginx:1.27-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
