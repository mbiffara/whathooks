import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MetricsService } from './metrics.service';

@Module({
  imports: [WhatsappModule],
  providers: [MetricsService],
})
export class MetricsModule {}
