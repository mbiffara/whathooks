import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';

@Module({
  imports: [WhatsappModule],
  controllers: [FlowsController],
  providers: [FlowsService],
})
export class FlowsModule {}
