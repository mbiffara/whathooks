import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { BillingModule } from '../billing/billing.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [MediaModule, WhatsappModule, ApiKeysModule, BillingModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
