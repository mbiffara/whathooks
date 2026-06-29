# Deploying whathooks

Best-of-breed split:

- **`web/`** → Vercel (already deployed)
- **`api/`** → AWS ECS Fargate (this guide), reusing your **existing** RDS Postgres
  + ElastiCache **Valkey** (Redis-compatible — the `ioredis` client and the
  `redis://` / `rediss://` URL scheme work unchanged)

The `api` is the stateful Baileys process, so it runs as a **single Fargate task**
(`desiredCount: 1`). Don't raise that count without first building the
session→worker routing layer — two processes holding the same WhatsApp creds will
fight. Deploys **stop the old task before starting the new one**
(`minHealthyPercent: 0`) for the same reason; expect a few seconds of downtime per
deploy until the worker split exists.

The task runs **in the same VPC** as your RDS + Valkey so it can reach them over
private networking. The stack imports that VPC and both data-tier security groups,
and adds an ingress rule from the api task's security group.

> **Cache:** the app uses `ioredis`, which is fully compatible with ElastiCache
> **Valkey** (and Redis). No code change — just point `WH_REDIS_URL` at your Valkey
> endpoint. If in-transit encryption is on (always for Serverless), use the
> `rediss://` scheme; add an auth token as `rediss://:TOKEN@host:6379`.

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity` works)
- Docker running locally (CDK builds the image at deploy time)
- Node 22, and CDK bootstrapped once per account/region: `npx cdk bootstrap`
- Your existing **VPC id**, **RDS** + **Valkey** endpoints and **security group ids**

## 1. Put the connection string in Secrets Manager

The api reads a single `DATABASE_URL`. Store it as a secret (don't pass it on the
command line):

```bash
aws secretsmanager create-secret \
  --name whathooks/database-url \
  --secret-string 'postgresql://USER:PASS@YOUR-RDS-HOST:5432/whathooks?schema=public'
# → note the returned ARN
```

> Make sure the database (`whathooks` here) exists on your RDS instance, and that
> the user can create tables — the container runs `prisma migrate deploy` on start.

## 2. (Recommended) Request an HTTPS certificate

The Vercel frontend is HTTPS, so the browser will **block** calls to an HTTP api
(mixed content). In **ACM** (same region), request a public cert for your api
hostname (e.g. `api.yourdomain.com`), validate via DNS, and copy the **cert ARN**.

## 3. Deploy the stack

Configuration is read from a CDK context flag (`-c key=value`) **or** an
environment variable — so you don't have to type the flags every time.

**Option A — local `.env` file (recommended):**

```bash
cd infra
npm install
cp .env.example .env     # then fill in your ids/ARNs (gitignored)
npm run deploy           # = cdk deploy, picks up infra/.env automatically
```

**Option B — one-off flags:**

```bash
npx cdk deploy \
  -c vpcId=vpc-0abc123... \
  -c databaseUrlSecretArn=arn:aws:secretsmanager:REGION:ACCT:secret:whathooks/database-url-XXXX \
  -c redisUrl=rediss://your-valkey-host:6379 \
  -c dbSecurityGroupId=sg-0rds... \
  -c redisSecurityGroupId=sg-0valkey... \
  -c webOrigin=https://YOUR-APP.vercel.app \
  -c certArn=arn:aws:acm:REGION:ACCT:certificate/XXXX \
  -c domainName=api.yourdomain.com
```

Optional: `WH_DB_PORT` / `-c dbPort=5432`, and `WH_TASK_SUBNET_TYPE` /
`-c taskSubnetType=private` (default `public`, which assigns the task a public IP
so it can pull the image without a NAT gateway; use `private` only if your VPC has
private subnets **with** NAT egress).

Outputs include **AlbDnsName**, **ApiBaseUrl**, and **ApiTaskSecurityGroupId**.

### Deploy from GitHub Actions instead

**One-time: create the OIDC deploy role.** CI authenticates to AWS via GitHub
OIDC (no long-lived keys). Create the provider + role once, with admin creds:

```bash
aws cloudformation deploy \
  --template-file infra/github-oidc-role.yml \
  --stack-name whathooks-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubOrg=mbiffara GitHubRepo=whathooks
# If the account already has the GitHub OIDC provider, add:
#   CreateOIDCProvider=false
aws cloudformation describe-stacks --stack-name whathooks-github-oidc \
  --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" --output text
```

The role is least-privilege — it can only assume the `cdk-*` bootstrap roles, so
the account must be bootstrapped (`npx cdk bootstrap`) first. Put the printed ARN
in the `AWS_DEPLOY_ROLE_ARN` secret. To restrict which branch can deploy, pass
`SubjectFilter=ref:refs/heads/main`.

`.github/workflows/deploy-api.yml` runs the same deploy in CI. Add these repo
**secrets** (same names as the `.env` keys, plus AWS auth) and trigger the
**Deploy API** workflow from the Actions tab:

| Secret | Value |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | IAM role ARN for GitHub OIDC, with CDK deploy permissions |
| `AWS_REGION` | e.g. `us-east-1` |
| `WH_VPC_ID`, `WH_DATABASE_URL_SECRET_ARN`, `WH_REDIS_URL`, `WH_DB_SG_ID`, `WH_REDIS_SG_ID`, `WH_WEB_ORIGIN` | required |
| `WH_CERT_ARN`, `WH_DOMAIN_NAME` | optional |

The workflow is `workflow_dispatch` (manual) by default; uncomment the `push`
block in it to deploy automatically when `api/` or `infra/` change on `main`.
Bootstrap the account once (`npx cdk bootstrap`) before the first CI run.

## 4. Point DNS at the ALB

Create a CNAME: `api.yourdomain.com` → the **AlbDnsName** output.

## 5. Wire up Vercel

In the Vercel project (root dir `web`), set and redeploy:

- `API_URL` = `https://api.yourdomain.com/v1`
- `NEXT_PUBLIC_API_URL` = `https://api.yourdomain.com/v1`

## What the stack creates vs. imports

| Resource | |
| --- | --- |
| VPC | **imported** (`vpcId`) |
| RDS Postgres | **imported** — reached via `DATABASE_URL` secret; SG opened to task |
| ElastiCache Valkey/Redis | **imported** — reached via `redisUrl` (use `rediss://` if TLS); SG opened to task |
| ECS cluster + Fargate service | created — 1 task, 0.5 vCPU / 1 GB |
| ALB | created — HTTPS→HTTP redirect (with cert); health check `GET /v1/health` |
| Secrets Manager (`JWT_SECRET`) | created |
| api task security group | created — added as ingress to your RDS/Redis SGs |

## Migrations

The container entrypoint runs `prisma migrate deploy` on every start, so schema
changes ship with the image. No manual migration step.

## First admin user

Registration only creates `CLIENT` users. To make a platform admin, promote one
after signup against your RDS:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'you@yourdomain.com';
```

## Rough cost (us-east-1, always-on)

Since RDS + Redis are reused, the new spend is roughly **~$35/mo**: Fargate
0.5 vCPU / 1 GB (~$18) + ALB (~$16) + logs/secrets. No new database cost.

## Tear down

```bash
cd infra && npx cdk destroy
```

This removes only what the stack created (cluster, service, ALB, JWT secret, and
the ingress rules it added to your SGs). Your RDS, Redis, and VPC are untouched.
