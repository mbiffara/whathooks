import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [WhatsappModule],
  controllers: [AdminController],
})
export class AdminModule {}
