#!/usr/bin/env node
import 'source-map-support/register';
import 'dotenv/config'; // loads infra/.env when present (gitignored)
import * as cdk from 'aws-cdk-lib';
import { WhathooksApiStack } from '../lib/whathooks-api-stack';

const app = new cdk.App();

// Resolve each setting from a CDK context flag (-c key=value) first, then an
// environment variable (from infra/.env locally, or GitHub secrets in CI).
const val = (cdkKey: string, envKey: string): string | undefined =>
  (app.node.tryGetContext(cdkKey) as string | undefined) ?? process.env[envKey];

const config = {
  vpcId: val('vpcId', 'WH_VPC_ID'),
  databaseUrlSecretArn: val('databaseUrlSecretArn', 'WH_DATABASE_URL_SECRET_ARN'),
  redisUrl: val('redisUrl', 'WH_REDIS_URL'),
  dbSecurityGroupId: val('dbSecurityGroupId', 'WH_DB_SG_ID'),
  redisSecurityGroupId: val('redisSecurityGroupId', 'WH_REDIS_SG_ID'),
  webOrigin: val('webOrigin', 'WH_WEB_ORIGIN'),
  domainName: val('domainName', 'WH_DOMAIN_NAME'),
  hostedZoneId: val('hostedZoneId', 'WH_HOSTED_ZONE_ID'),
  hostedZoneName: val('hostedZoneName', 'WH_HOSTED_ZONE_NAME'),
  certArn: val('certArn', 'WH_CERT_ARN'),
  dbPort: val('dbPort', 'WH_DB_PORT'),
  redisPort: val('redisPort', 'WH_REDIS_PORT'),
  taskSubnetType: val('taskSubnetType', 'WH_TASK_SUBNET_TYPE'),
};

const required: (keyof typeof config)[] = [
  'vpcId',
  'databaseUrlSecretArn',
  'redisUrl',
  'dbSecurityGroupId',
  'redisSecurityGroupId',
];
const missing = required.filter((k) => !config[k]);
if (missing.length) {
  throw new Error(
    `Missing required config: ${missing.join(', ')}.\n` +
      `Set them in infra/.env (see .env.example), as GitHub secrets, or with -c key=value.`,
  );
}

new WhathooksApiStack(app, 'WhathooksApi', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  webOrigin: config.webOrigin ?? 'https://your-app.vercel.app',
  vpcId: config.vpcId!,
  databaseUrlSecretArn: config.databaseUrlSecretArn!,
  redisUrl: config.redisUrl!,
  dbSecurityGroupId: config.dbSecurityGroupId!,
  redisSecurityGroupId: config.redisSecurityGroupId!,
  dbPort: config.dbPort ? Number(config.dbPort) : undefined,
  redisPort: config.redisPort ? Number(config.redisPort) : undefined,
  taskSubnetType: config.taskSubnetType === 'private' ? 'private' : undefined,
  domainName: config.domainName,
  hostedZoneId: config.hostedZoneId,
  hostedZoneName: config.hostedZoneName,
  certArn: config.certArn,
});
