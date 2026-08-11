import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { MessageStoreModule } from '../channels/message-store.module';
import { AgentReplyModule } from '../channels/agent-reply.module';
import { SessionAlertModule } from '../channels/session-alert.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { InstagramController } from './instagram.controller';
import { InstagramChannelDriver } from './instagram-channel.driver';
import { InstagramHealthService } from './instagram-health.service';
import { InstagramIngestService } from './instagram-ingest.service';
import { InstagramService } from './instagram.service';
import { InstagramWebhookController } from './instagram-webhook.controller';
import { ZernioService } from './zernio.service';

/** Instagram DMs via the Zernio API. */
@Module({
  imports: [
    AuthModule,
    ApiKeysModule,
    BillingModule,
    MessageStoreModule,
    AgentReplyModule,
    SessionAlertModule,
    WebhooksModule,
  ],
  controllers: [InstagramController, InstagramWebhookController],
  providers: [
    InstagramService,
    ZernioService,
    InstagramIngestService,
    InstagramChannelDriver,
    InstagramHealthService,
  ],
  exports: [ZernioService, InstagramChannelDriver],
})
export class InstagramModule {}
