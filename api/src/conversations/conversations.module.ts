import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ChannelsModule } from '../channels/channels.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [AuthModule, WhatsappModule,
    ChannelsModule, BillingModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
