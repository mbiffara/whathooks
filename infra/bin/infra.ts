#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WhathooksApiStack } from '../lib/whathooks-api-stack';

const app = new cdk.App();

// Required-ish context (pass with -c key=value or via cdk.context.json):
//   webOrigin  — your Vercel app URL, used for CORS (e.g. https://whathooks.vercel.app)
//   certArn    — ACM certificate ARN for the api subdomain (enables HTTPS). Optional.
//   domainName — the api hostname the cert covers (e.g. api.whathooks.com). Optional, for outputs.
const webOrigin =
  app.node.tryGetContext('webOrigin') ?? 'https://your-app.vercel.app';
const certArn = app.node.tryGetContext('certArn') as string | undefined;
const domainName = app.node.tryGetContext('domainName') as string | undefined;

new WhathooksApiStack(app, 'WhathooksApi', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  webOrigin,
  certArn,
  domainName,
});
