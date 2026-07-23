import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [BillingModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatchService],
  exports: [WebhookDispatchService],
})
export class WebhooksModule {}
