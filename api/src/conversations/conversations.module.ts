import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [WhatsappModule, BillingModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
