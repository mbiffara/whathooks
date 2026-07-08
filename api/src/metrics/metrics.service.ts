import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionManagerService } from '../whatsapp/connection-manager.service';

/**
 * Publishes operational gauges to CloudWatch every minute (active Baileys
 * sessions + process RSS) so capacity/headroom is visible and alarmable.
 * Disabled unless METRICS_NAMESPACE is set (i.e. off locally).
 */
@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MetricsService.name);
  private readonly namespace?: string;
  private readonly cw?: CloudWatchClient;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: ConfigService,
    private readonly manager: ConnectionManagerService,
  ) {
    this.namespace = this.config.get<string>('METRICS_NAMESPACE') || undefined;
    if (this.namespace) {
      this.cw = new CloudWatchClient({
        region: this.config.get<string>('AWS_REGION', 'us-east-1'),
      });
    }
  }

  onModuleInit() {
    if (!this.namespace) {
      this.log.log('CloudWatch metrics disabled (no METRICS_NAMESPACE)');
      return;
    }
    this.log.log(
      `Publishing metrics to CloudWatch namespace "${this.namespace}"`,
    );
    this.timer = setInterval(() => void this.publish(), 60_000);
    setTimeout(() => void this.publish(), 10_000); // first sample soon after boot
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async publish() {
    if (!this.cw || !this.namespace) return;
    try {
      const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
      await this.cw.send(
        new PutMetricDataCommand({
          Namespace: this.namespace,
          MetricData: [
            {
              MetricName: 'ActiveSessions',
              Value: this.manager.getLiveSessionCount(),
              Unit: 'Count',
            },
            {
              MetricName: 'ProcessMemoryMB',
              Value: rssMb,
              Unit: 'Megabytes',
            },
          ],
        }),
      );
    } catch (e) {
      this.log.warn(`Metric publish failed: ${e}`);
    }
  }
}
