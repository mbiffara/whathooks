import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { BillingService } from './billing.service';
import { QuotaService } from './quota.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly quota: QuotaService,
  ) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  /** Current plan, limits and subscription status — any member may read. */
  @Get('subscription')
  subscription(@CurrentUser() user: AuthUser) {
    return this.billing.status(this.orgOf(user));
  }

  /** Start Stripe Checkout for a plan. Owner-only. */
  @OrgRoles('OWNER')
  @Post('checkout')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: CreateCheckoutDto) {
    return this.billing.createCheckoutSession(
      this.orgOf(user),
      dto.plan,
      dto.interval ?? 'month',
    );
  }

  /** Allowance, carried-over balance, and the usage tables. Any member. */
  @Get('ai-tokens')
  aiTokens(@CurrentUser() user: AuthUser) {
    return this.quota.aiTokenReport(this.orgOf(user));
  }

  /** Token-pack purchase history for the billing page. Any member. */
  @Get('ai-tokens/purchases')
  aiTokenPurchases(@CurrentUser() user: AuthUser) {
    return this.quota.aiTokenPurchases(this.orgOf(user));
  }

  /** Buy a token pack (one-off payment, balance carries over). Owner-only. */
  @OrgRoles('OWNER')
  @Post('tokens/checkout')
  tokenCheckout(@CurrentUser() user: AuthUser) {
    return this.billing.createTokenCheckout(this.orgOf(user));
  }

  /** Open the Stripe customer portal. Owner-only. */
  @OrgRoles('OWNER')
  @Post('portal')
  portal(@CurrentUser() user: AuthUser) {
    return this.billing.createPortalSession(this.orgOf(user));
  }
}
