# whathooks

WhatsApp-as-a-webhook SaaS. Clients connect their WhatsApp number via QR (powered by
[Baileys](https://github.com/whiskeysockets/Baileys)), receive inbound messages on their own
webhook, and post replies back through our API — we deliver them.

## Architecture

```
web/   Next.js frontend — landing, docs, auth, client + admin dashboards
api/   NestJS backend  — REST API, auth, API keys, and the Baileys connection worker
```

- **Postgres** (Prisma) — users, WhatsApp sessions, webhooks, API keys, message log
- **Redis** — pub/sub + queue between API and connection workers (and QR delivery)
- **Auth** — Auth.js (NextAuth) in the frontend wraps a backend-issued JWT; clients call the
  message API with **API keys**

The backend owns the database and all WhatsApp sockets. Baileys holds one long-lived WebSocket
per connected number, so it must run in a persistent process (never serverless).

## Local development

```bash
# 1. infra
docker compose up -d           # postgres + redis

# 2. backend
cd api
cp .env.example .env
pnpm install
pnpm prisma migrate dev        # apply schema
pnpm start:dev                 # http://localhost:3001

# 3. frontend
cd ../web
cp .env.example .env.local
pnpm install
pnpm dev                       # http://localhost:3000
```

## Status

Foundation milestone — see `docs/` and the build plan in project notes.
