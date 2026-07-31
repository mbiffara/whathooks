import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AuthModule } from '../auth/auth.module';
import { AgentsModule } from '../agents/agents.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { BillingModule } from '../billing/billing.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ConnectionManagerService } from './connection-manager.service';
import { PublicConnectController } from './public-connect.controller';
import { SessionsController } from './sessions.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [
    AuthModule,
    MailModule,
    WebhooksModule,
    AgentsModule,
    BillingModule,
    ApiKeysModule,
  ],
  controllers: [SessionsController, PublicConnectController],
  providers: [ConnectionManagerService, WhatsappService],
  exports: [ConnectionManagerService, WhatsappService],
})
export class WhatsappModule {}
