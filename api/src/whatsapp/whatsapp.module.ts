import { Module } from '@nestjs/common';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ConnectionManagerService } from './connection-manager.service';
import { SessionsController } from './sessions.controller';
import { WhatsappService } from './whatsapp.service';

@Module({
  imports: [WebhooksModule],
  controllers: [SessionsController],
  providers: [ConnectionManagerService, WhatsappService],
  exports: [ConnectionManagerService, WhatsappService],
})
export class WhatsappModule {}
