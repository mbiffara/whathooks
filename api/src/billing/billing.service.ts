import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Plan } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, planForPriceId } from './plans';
import { QuotaService } from './quota.service';

@Injectable()
export class BillingService {
  private readonly log = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;
  private readonly webhookSecret?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.stripe = key ? new Stripe(key) : null;
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!this.stripe) {
      this.log.warn('STRIPE_SECRET_KEY not set — billing endpoints disabled');
    }
  }

  private client(): Stripe {
    if (!this.stripe) {
      throw new BadRequestException('Billing is not configured');
    }
    return this.stripe;
  }

  private priceIdFor(plan: Plan): string {
    const id = this.config.get<string>(PLANS[plan].priceEnv);
    if (!id) {
      throw new BadRequestException(`No Stripe price configured for ${plan}`);
    }
    return id;
  }

  private webBase(): string {
    return this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:3000')
      .split(',')[0]
      .trim();
  }

  /** Current entitlement + usage-relevant billing state for an org. */
  async status(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        plan: true,
        subscriptionStatus: true,
        currentPeriodEnd: true,
        stripeCustomerId: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    const usage = await this.quota.messageUsage(organizationId);
    return {
      plan: org.plan,
      limits: PLANS[org.plan],
      status: org.subscriptionStatus,
      currentPeriodEnd: org.currentPeriodEnd,
      hasCustomer: Boolean(org.stripeCustomerId),
      usage,
    };
  }

  /** Find-or-create the Stripe customer backing an org. */
  private async ensureCustomer(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.stripeCustomerId) return org.stripeCustomerId;

    const owner = await this.prisma.membership.findFirst({
      where: { organizationId, role: 'OWNER' },
      include: { user: true },
    });
    const customer = await this.client().customers.create({
      name: org.name,
      email: owner?.user.email,
      metadata: { organizationId },
    });
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }

  /** Create a Checkout Session for a plan; returns the redirect URL. */
  async createCheckoutSession(
    organizationId: string,
    plan: Plan,
  ): Promise<{ url: string }> {
    const customerId = await this.ensureCustomer(organizationId);
    const base = this.webBase();
    const session = await this.client().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: this.priceIdFor(plan), quantity: 1 }],
      success_url: `${base}/dashboard/billing?checkout=success`,
      cancel_url: `${base}/dashboard/billing?checkout=cancel`,
      client_reference_id: organizationId,
      subscription_data: { metadata: { organizationId } },
      allow_promotion_codes: true,
    });
    if (!session.url) throw new BadRequestException('Could not start checkout');
    return { url: session.url };
  }

  /** Create a Customer Portal session (manage/cancel/update card). */
  async createPortalSession(organizationId: string): Promise<{ url: string }> {
    const customerId = await this.ensureCustomer(organizationId);
    const session = await this.client().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.webBase()}/dashboard/billing`,
    });
    return { url: session.url };
  }

  /** Verify a webhook payload and return the parsed event. */
  constructEvent(payload: Buffer, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new BadRequestException('Webhook secret not configured');
    }
    return this.client().webhooks.constructEvent(
      payload,
      signature,
      this.webhookSecret,
    );
  }

  /** Apply a Stripe event to our org billing state. Idempotent. */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await this.syncSubscription(event.data.object);
        break;
      }
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.subscription) {
          const sub = await this.client().subscriptions.retrieve(
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id,
          );
          await this.syncSubscription(sub);
        }
        break;
      }
      default:
        this.log.debug(`Unhandled Stripe event ${event.type}`);
    }
  }

  /** Write a Stripe subscription's state onto the owning organization. */
  private async syncSubscription(sub: Stripe.Subscription): Promise<void> {
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const org = await this.prisma.organization.findFirst({
      where: {
        OR: [
          { stripeCustomerId: customerId },
          { id: sub.metadata?.organizationId ?? '__none__' },
        ],
      },
    });
    if (!org) {
      this.log.warn(`No org for Stripe customer ${customerId}`);
      return;
    }

    const priceId = sub.items.data[0]?.price.id;
    const plan =
      planForPriceId(priceId, process.env) ??
      // deleted/canceled subs keep the last known tier
      org.plan;
    const canceled = sub.status === 'canceled';
    const periodEnd = sub.items.data[0]?.current_period_end;

    await this.prisma.organization.update({
      where: { id: org.id },
      data: {
        stripeSubscriptionId: canceled ? null : sub.id,
        stripePriceId: canceled ? null : priceId,
        plan,
        subscriptionStatus: sub.status,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      },
    });
    this.log.log(`Org ${org.id} -> plan=${plan} status=${sub.status}`);
  }
}
