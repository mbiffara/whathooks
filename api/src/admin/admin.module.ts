import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [MailModule, WhatsappModule],
  controllers: [AdminController],
})
export class AdminModule {}
