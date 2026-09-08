import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma sizes its pool from the CPU count it can see. On a Fargate task
 * with half a vCPU that came out to 3 connections for the whole API, so the
 * dashboards' polling, inbound messages and one slow query were enough to
 * make every request queue for a connection. The pool is now explicit and
 * comes from the environment, so it can be tuned without a code change.
 */
const DEFAULT_POOL_SIZE = 10;
const DEFAULT_POOL_TIMEOUT_S = 20;

function withPool(url: string | undefined): string | undefined {
  if (!url) return url;
  const u = new URL(url);
  if (!u.searchParams.has('connection_limit')) {
    u.searchParams.set(
      'connection_limit',
      process.env.DATABASE_POOL_SIZE ?? String(DEFAULT_POOL_SIZE),
    );
  }
  if (!u.searchParams.has('pool_timeout')) {
    u.searchParams.set(
      'pool_timeout',
      process.env.DATABASE_POOL_TIMEOUT ?? String(DEFAULT_POOL_TIMEOUT_S),
    );
  }
  return u.toString();
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ datasourceUrl: withPool(process.env.DATABASE_URL) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
