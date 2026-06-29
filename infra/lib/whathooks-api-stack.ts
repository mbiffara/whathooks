import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import {
  aws_certificatemanager as acm,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticache as elasticache,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_rds as rds,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface WhathooksApiStackProps extends cdk.StackProps {
  /** Vercel app origin allowed by CORS, e.g. https://whathooks.vercel.app */
  webOrigin: string;
  /** ACM certificate ARN for the api subdomain. When set, the ALB serves HTTPS. */
  certArn?: string;
  /** The api hostname the cert covers, for output clarity. */
  domainName?: string;
}

export class WhathooksApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WhathooksApiStackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------
    // Network — public subnets for the task (no NAT cost) + isolated for data
    // ---------------------------------------------------------------------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ---------------------------------------------------------------------
    // Postgres (RDS) — only reachable from the api task
    // ---------------------------------------------------------------------
    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of('16.4', '16'),
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MICRO,
      ),
      credentials: rds.Credentials.fromGeneratedSecret('whathooks', {
        // keep the password URL-safe so we can build DATABASE_URL by hand
        excludeCharacters: '/@" \\\'%:?#[]&',
      }),
      databaseName: 'whathooks',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(7),
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // ---------------------------------------------------------------------
    // Redis (ElastiCache, single node)
    // ---------------------------------------------------------------------
    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc,
      description: 'whathooks redis',
      allowAllOutbound: true,
    });
    const redisSubnets = new elasticache.CfnSubnetGroup(this, 'RedisSubnets', {
      description: 'whathooks redis subnets',
      subnetIds: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }).subnetIds,
    });
    const redis = new elasticache.CfnCacheCluster(this, 'Redis', {
      engine: 'redis',
      cacheNodeType: 'cache.t4g.micro',
      numCacheNodes: 1,
      vpcSecurityGroupIds: [redisSg.securityGroupId],
      cacheSubnetGroupName: redisSubnets.ref,
    });
    redis.addDependency(redisSubnets);
    const redisUrl = `redis://${redis.attrRedisEndpointAddress}:${redis.attrRedisEndpointPort}`;

    // ---------------------------------------------------------------------
    // Secrets — app JWT signing secret
    // ---------------------------------------------------------------------
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 48,
      },
    });

    // ---------------------------------------------------------------------
    // ECS Fargate — the stateful Baileys api (single owner per socket → 1 task)
    // ---------------------------------------------------------------------
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const taskDef = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
    });

    const image = ecs.ContainerImage.fromAsset(
      path.join(__dirname, '..', '..', 'api'),
    );

    taskDef.addContainer('api', {
      image,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'whathooks-api',
        logRetention: logs.RetentionDays.TWO_WEEKS,
      }),
      portMappings: [{ containerPort: 3001 }],
      environment: {
        NODE_ENV: 'production',
        PORT: '3001',
        API_KEY_PREFIX: 'wh_live',
        JWT_EXPIRES_IN: '7d',
        WEB_ORIGIN: props.webOrigin,
        REDIS_URL: redisUrl,
      },
      secrets: {
        DB_HOST: ecs.Secret.fromSecretsManager(db.secret!, 'host'),
        DB_PORT: ecs.Secret.fromSecretsManager(db.secret!, 'port'),
        DB_USER: ecs.Secret.fromSecretsManager(db.secret!, 'username'),
        DB_PASS: ecs.Secret.fromSecretsManager(db.secret!, 'password'),
        DB_NAME: ecs.Secret.fromSecretsManager(db.secret!, 'dbname'),
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
      },
    });

    const service = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      // Stop the old task before starting the new one — never run two Baileys
      // processes for the same numbers at once.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      circuitBreaker: { rollback: true },
    });

    // data-tier access
    db.connections.allowDefaultPortFrom(service, 'api task');
    redisSg.addIngressRule(
      service.connections.securityGroups[0],
      ec2.Port.tcp(6379),
      'api task',
    );

    // ---------------------------------------------------------------------
    // ALB
    // ---------------------------------------------------------------------
    const lb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
    });

    const cert = props.certArn
      ? acm.Certificate.fromCertificateArn(this, 'Cert', props.certArn)
      : undefined;

    let listener: elbv2.ApplicationListener;
    if (cert) {
      lb.addListener('HttpRedirect', {
        port: 80,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });
      listener = lb.addListener('Https', {
        port: 443,
        certificates: [cert],
        open: true,
      });
    } else {
      // No cert → HTTP only. NOTE: browsers will block calls from the (HTTPS)
      // Vercel frontend to an HTTP api (mixed content). Add a cert for prod.
      listener = lb.addListener('Http', { port: 80, open: true });
    }

    listener.addTargets('ApiTarget', {
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [
        service.loadBalancerTarget({ containerName: 'api', containerPort: 3001 }),
      ],
      healthCheck: {
        path: '/v1/health',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
      },
      deregistrationDelay: cdk.Duration.seconds(10),
    });

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: lb.loadBalancerDnsName,
      description: 'Point your api subdomain (CNAME) at this, then use it as API_URL',
    });
    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: cert
        ? `https://${props.domainName ?? lb.loadBalancerDnsName}/v1`
        : `http://${lb.loadBalancerDnsName}/v1`,
    });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: db.secret!.secretArn });
    new cdk.CfnOutput(this, 'RedisEndpoint', { value: redisUrl });
  }
}
