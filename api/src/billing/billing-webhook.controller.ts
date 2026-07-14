import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';

/**
 * Stripe webhook receiver. Unauthenticated (verified by Stripe signature) and
 * kept separate from BillingController so it isn't behind the JWT guard. Needs
 * the raw request body — enabled via `rawBody: true` in main.ts.
 */
@Controller('billing')
export class BillingWebhookController {
  private readonly log = new Logger(BillingWebhookController.name);

  constructor(private readonly billing: BillingService) {}

  @Post('webhook')
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing signature or body');
    }
    let event;
    try {
      event = this.billing.constructEvent(req.rawBody, signature);
    } catch (err) {
      this.log.warn(`Invalid Stripe signature: ${(err as Error).message}`);
      throw new BadRequestException('Invalid signature');
    }
    await this.billing.handleEvent(event);
    return { received: true };
  }
}
