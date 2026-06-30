import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import {
  aws_certificatemanager as acm,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as route53Targets,
  aws_s3 as s3,
  aws_secretsmanager as secretsmanager,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface WhathooksApiStackProps extends cdk.StackProps {
  /** Vercel app origin allowed by CORS, e.g. https://whathooks.vercel.app */
  webOrigin: string;
  /** The VPC that already hosts your RDS + ElastiCache instances. */
  vpcId: string;
  /** Secrets Manager ARN whose value is the full DATABASE_URL connection string. */
  databaseUrlSecretArn: string;
  /**
   * Connection URL for your existing ElastiCache cache (Valkey or Redis — same
   * wire protocol). Use redis://host:6379, or rediss://host:6379 when in-transit
   * encryption is on, optionally with an auth token: rediss://:TOKEN@host:6379
   */
  redisUrl: string;
  /** Existing RDS security group — opened to the api task on its DB port. */
  dbSecurityGroupId: string;
  /** Existing cache (Valkey/Redis) security group — opened to the api task. */
  redisSecurityGroupId: string;
  /** DB port (default 5432). */
  dbPort?: number;
  /** Cache port (default 6379). */
  redisPort?: number;
  /** Place the task in 'public' (default, assigns a public IP) or 'private' subnets. */
  taskSubnetType?: 'public' | 'private';
  /** The api hostname, e.g. api.example.com. */
  domainName?: string;
  /**
   * Route 53 hosted zone for the domain. When set together with domainName, the
   * stack creates + DNS-validates an ACM cert and an alias record automatically.
   */
  hostedZoneId?: string;
  hostedZoneName?: string;
  /** Alternative to hostedZone*: an already-issued ACM certificate ARN. */
  certArn?: string;
}

export class WhathooksApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WhathooksApiStackProps) {
    super(scope, id, props);

    const dbPort = props.dbPort ?? 5432;
    const redisPort = props.redisPort ?? 6379;

    // ---------------------------------------------------------------------
    // Import the VPC that already contains RDS + ElastiCache
    // ---------------------------------------------------------------------
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: props.vpcId });

    const usePrivate = props.taskSubnetType === 'private';
    const taskSubnets: ec2.SubnetSelection = usePrivate
      ? { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
      : { subnetType: ec2.SubnetType.PUBLIC };

    // Security group for the api task; we open the existing data-tier SGs to it.
    const taskSg = new ec2.SecurityGroup(this, 'ApiSg', {
      vpc,
      description: 'whathooks api task',
      allowAllOutbound: true,
    });

    const dbSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ImportedDbSg',
      props.dbSecurityGroupId,
      { mutable: true },
    );
    dbSg.addIngressRule(taskSg, ec2.Port.tcp(dbPort), 'whathooks api');

    const redisSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ImportedRedisSg',
      props.redisSecurityGroupId,
      { mutable: true },
    );
    redisSg.addIngressRule(taskSg, ec2.Port.tcp(redisPort), 'whathooks api');

    // ---------------------------------------------------------------------
    // Secrets — DATABASE_URL (existing) + a generated JWT signing secret
    // ---------------------------------------------------------------------
    const dbUrlSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'DatabaseUrlSecret',
      props.databaseUrlSecretArn,
    );
    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    });

    // ---------------------------------------------------------------------
    // Media bucket (private; browser loads objects via presigned URLs)
    // ---------------------------------------------------------------------
    const mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // ---------------------------------------------------------------------
    // ECS Fargate — the stateful Baileys api (single owner per socket → 1 task)
    // ---------------------------------------------------------------------
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const taskDef = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      // The image is built locally; match the build host (Apple Silicon → arm64).
      // Graviton is also cheaper. If you build x86 images in CI, switch to X86_64.
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
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
        REDIS_URL: props.redisUrl,
        MEDIA_BUCKET: mediaBucket.bucketName,
        AWS_REGION: this.region,
        PUBLIC_API_URL: props.domainName
          ? `https://${props.domainName}`
          : '',
      },
      secrets: {
        // Whole secret value is the connection string → injected as DATABASE_URL.
        DATABASE_URL: ecs.Secret.fromSecretsManager(dbUrlSecret),
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
      },
    });

    mediaBucket.grantReadWrite(taskDef.taskRole);

    const service = new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: !usePrivate,
      vpcSubnets: taskSubnets,
      securityGroups: [taskSg],
      // Stop the old task before starting the new one — never run two Baileys
      // processes for the same numbers at once.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      circuitBreaker: { rollback: true },
    });

    // ---------------------------------------------------------------------
    // ALB
    // ---------------------------------------------------------------------
    const lb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
    });

    // Resolve a certificate: prefer a Route 53-managed cert (created + DNS
    // validated here), else an imported ARN, else none (HTTP only).
    const zone =
      props.hostedZoneId && props.hostedZoneName
        ? route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.hostedZoneName,
          })
        : undefined;

    let cert: acm.ICertificate | undefined;
    if (zone && props.domainName) {
      cert = new acm.Certificate(this, 'Cert', {
        domainName: props.domainName,
        validation: acm.CertificateValidation.fromDns(zone),
      });
    } else if (props.certArn) {
      cert = acm.Certificate.fromCertificateArn(this, 'Cert', props.certArn);
    }

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
      // No cert → HTTP only. NOTE: browsers block calls from the (HTTPS) Vercel
      // frontend to an HTTP api (mixed content). Add a cert for prod.
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

    // Point the api hostname at the ALB automatically when we manage the zone.
    if (zone && props.domainName) {
      new route53.ARecord(this, 'AliasRecord', {
        zone,
        recordName: props.domainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(lb),
        ),
      });
    }

    // ---------------------------------------------------------------------
    // Outputs
    // ---------------------------------------------------------------------
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: lb.loadBalancerDnsName,
      description:
        'ALB hostname (DNS alias is created automatically when a hosted zone is set)',
    });
    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: cert
        ? `https://${props.domainName ?? lb.loadBalancerDnsName}/v1`
        : `http://${lb.loadBalancerDnsName}/v1`,
    });
    new cdk.CfnOutput(this, 'ApiTaskSecurityGroupId', {
      value: taskSg.securityGroupId,
      description: 'Security group of the api task (already opened to RDS/Redis)',
    });
  }
}
