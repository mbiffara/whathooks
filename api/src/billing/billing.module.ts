import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MarketingModule } from '../marketing/marketing.module';
import { BillingController } from './billing.controller';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingService } from './billing.service';
import { QuotaService } from './quota.service';

@Module({
  imports: [AuthModule, MarketingModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService, QuotaService],
  exports: [QuotaService, BillingService],
})
export class BillingModule {}
