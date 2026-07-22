import { Module } from '@nestjs/common';
import { XConversionsService } from './x-conversions.service';

@Module({
  providers: [XConversionsService],
  exports: [XConversionsService],
})
export class MarketingModule {}
