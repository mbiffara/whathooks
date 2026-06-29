# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /app

# Toolchain for native deps (argon2) + prisma engine runtime lib
RUN apk add --no-cache python3 make g++ openssl
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma generate && pnpm build

# ---- runner ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# openssl: required by the Prisma query engine; libstdc++: argon2 runtime
RUN apk add --no-cache openssl libstdc++

# Full node_modules (incl. generated Prisma client + prisma CLI for migrate deploy)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
