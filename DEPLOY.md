# Deploying whathooks

Best-of-breed split:

- **`web/`** → Vercel (already deployed)
- **`api/`** → AWS ECS Fargate (this guide), with RDS Postgres + ElastiCache Redis

The `api` is the stateful Baileys process, so it runs as a **single Fargate task**
(`desiredCount: 1`). Don't raise that count without first building the
session→worker routing layer — two processes holding the same WhatsApp creds will
fight. Deploys are configured to **stop the old task before starting the new one**
(`minHealthyPercent: 0`) for the same reason; expect a few seconds of downtime per
deploy until the worker split exists.

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity` works)
- Docker running locally (CDK builds the image)
- Node 22, and CDK bootstrapped once per account/region: `npx cdk bootstrap`

## 1. (Recommended) Request an HTTPS certificate

The Vercel frontend is HTTPS, so the browser will **block** calls to an HTTP api
(mixed content). You need TLS on the ALB:

1. In **ACM** (same region you'll deploy to), request a public cert for your api
   hostname, e.g. `api.yourdomain.com`.
2. Validate it via DNS (add the CNAME ACM shows you).
3. Copy the **certificate ARN**.

You can deploy without a cert to smoke-test (HTTP only), but the dashboard won't
work from Vercel until HTTPS is in place.

## 2. Deploy the stack

```bash
cd infra
npm install
npx cdk deploy \
  -c webOrigin=https://YOUR-APP.vercel.app \
  -c certArn=arn:aws:acm:REGION:ACCOUNT:certificate/XXXX \
  -c domainName=api.yourdomain.com
```

Outputs include **AlbDnsName** and **ApiBaseUrl**.

## 3. Point DNS at the ALB

Create a CNAME: `api.yourdomain.com` → the **AlbDnsName** output.

## 4. Wire up Vercel

In the Vercel project (root dir `web`), set and redeploy:

- `API_URL` = `https://api.yourdomain.com/v1`
- `NEXT_PUBLIC_API_URL` = `https://api.yourdomain.com/v1`
- `AUTH_SECRET` = (already set)

## What the stack creates

| Resource | Notes |
| --- | --- |
| VPC | 2 AZs, **no NAT** (task runs in a public subnet to pull images cheaply) |
| RDS Postgres 16 | `t4g.micro`, private, encrypted, 7-day backups, generated secret |
| ElastiCache Redis | `cache.t4g.micro`, single node, private |
| ECS Fargate service | 1 task, 0.5 vCPU / 1 GB, public subnet, ALB-fronted |
| ALB | HTTPS (with cert) → HTTP redirect; health check `GET /v1/health` |
| Secrets Manager | DB credentials + `JWT_SECRET` (injected, never in the image) |

## Migrations

The container entrypoint runs `prisma migrate deploy` on every start, so schema
changes ship with the image. No manual migration step.

## First admin user

Registration only creates `CLIENT` users. To make a platform admin, promote one
after signup (connect with the RDS secret, or via a one-off task):

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@yourdomain.com';
```

## Rough cost (us-east-1, always-on)

~$55–75/mo: Fargate 0.5vCPU/1GB (~$18) + RDS t4g.micro (~$13) + ElastiCache
t4g.micro (~$12) + ALB (~$16) + storage/secrets. Drop ElastiCache (unused for now)
or use a smaller ALB alternative to trim.

## Tear down

```bash
cd infra && npx cdk destroy
```

RDS uses `SNAPSHOT` removal — a final snapshot is kept. Delete it manually if you
don't want it.
