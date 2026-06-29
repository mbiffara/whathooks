import { Module } from '@nestjs/common';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatchService],
  exports: [WebhookDispatchService],
})
export class WebhooksModule {}
