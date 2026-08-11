import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { InstagramController } from './instagram.controller';
import { InstagramService } from './instagram.service';
import { InstagramWebhookController } from './instagram-webhook.controller';
import { ZernioService } from './zernio.service';

/** Instagram DMs via the Zernio API. */
@Module({
  imports: [AuthModule, ApiKeysModule, BillingModule],
  controllers: [InstagramController, InstagramWebhookController],
  providers: [InstagramService, ZernioService],
  exports: [ZernioService],
})
export class InstagramModule {}
