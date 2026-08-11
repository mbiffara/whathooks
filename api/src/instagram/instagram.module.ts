import { Module } from '@nestjs/common';
import { InstagramWebhookController } from './instagram-webhook.controller';

/**
 * Instagram DMs via the Zernio API. Currently only the webhook receiver, in
 * its capture phase — see instagram-webhook.controller.ts.
 */
@Module({
  controllers: [InstagramWebhookController],
})
export class InstagramModule {}
