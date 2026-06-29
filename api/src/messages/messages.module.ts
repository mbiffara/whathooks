import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [WhatsappModule, ApiKeysModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
