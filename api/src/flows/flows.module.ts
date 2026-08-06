import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';

@Module({
  imports: [WhatsappModule, BillingModule],
  controllers: [FlowsController],
  providers: [FlowsService],
})
export class FlowsModule {}
