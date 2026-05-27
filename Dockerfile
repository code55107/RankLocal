# syntax=docker/dockerfile:1.7

# ---------- Build stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

ENV HUSKY=0

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

COPY tsconfig*.json nest-cli.json ./
COPY src ./src

RUN pnpm build \
 && pnpm prune --prod --ignore-scripts

# ---------- Runtime stage ----------
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001

RUN addgroup -S ranklocal && adduser -S ranklocal -G ranklocal

COPY --from=builder --chown=ranklocal:ranklocal /app/node_modules ./node_modules
COPY --from=builder --chown=ranklocal:ranklocal /app/dist ./dist
COPY --from=builder --chown=ranklocal:ranklocal /app/package.json ./package.json

USER ranklocal

EXPOSE 3001

CMD ["node", "dist/main"]
