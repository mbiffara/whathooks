#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WhathooksApiStack } from '../lib/whathooks-api-stack';

const app = new cdk.App();
const ctx = (k: string) => app.node.tryGetContext(k) as string | undefined;

// Required context (pass with -c key=value or via cdk.context.json):
//   vpcId                 — the VPC that hosts your existing RDS + ElastiCache
//   databaseUrlSecretArn  — Secrets Manager ARN holding the full DATABASE_URL
//   redisUrl              — redis://your-elasticache-host:6379
//   dbSecurityGroupId     — existing RDS security group (opened to the task)
//   redisSecurityGroupId  — existing Redis security group (opened to the task)
//   webOrigin             — your Vercel app URL (CORS)
// Optional:
//   certArn, domainName, dbPort, taskSubnetType (public|private)
const required = {
  vpcId: ctx('vpcId'),
  databaseUrlSecretArn: ctx('databaseUrlSecretArn'),
  redisUrl: ctx('redisUrl'),
  dbSecurityGroupId: ctx('dbSecurityGroupId'),
  redisSecurityGroupId: ctx('redisSecurityGroupId'),
};
const missing = Object.entries(required)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  throw new Error(
    `Missing required context: ${missing.join(', ')}.\n` +
      `Pass them with -c key=value, e.g. -c vpcId=vpc-0abc...`,
  );
}

new WhathooksApiStack(app, 'WhathooksApi', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  webOrigin: ctx('webOrigin') ?? 'https://your-app.vercel.app',
  vpcId: required.vpcId!,
  databaseUrlSecretArn: required.databaseUrlSecretArn!,
  redisUrl: required.redisUrl!,
  dbSecurityGroupId: required.dbSecurityGroupId!,
  redisSecurityGroupId: required.redisSecurityGroupId!,
  dbPort: ctx('dbPort') ? Number(ctx('dbPort')) : undefined,
  taskSubnetType: ctx('taskSubnetType') === 'private' ? 'private' : undefined,
  certArn: ctx('certArn'),
  domainName: ctx('domainName'),
});
