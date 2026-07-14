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
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@UseGuards(JwtAuthGuard, OrgRolesGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

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
    return this.billing.createCheckoutSession(this.orgOf(user), dto.plan);
  }

  /** Open the Stripe customer portal. Owner-only. */
  @OrgRoles('OWNER')
  @Post('portal')
  portal(@CurrentUser() user: AuthUser) {
    return this.billing.createPortalSession(this.orgOf(user));
  }
}
