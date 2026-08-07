import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Plan } from '@prisma/client';
import Stripe from 'stripe';
import { MailService } from '../mail/mail.service';
import { XConversionsService } from '../marketing/x-conversions.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  PLANS,
  TOKEN_PACK,
  TRIAL_DAYS,
  planForPriceId,
  planRequiresSubscription,
} from './plans';
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
    private readonly xConversions: XConversionsService,
    private readonly mail: MailService,
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

  private priceIdFor(plan: Plan, interval: 'month' | 'year' = 'month'): string {
    const { priceEnv, annualPriceEnv } = PLANS[plan];
    const env = interval === 'year' ? annualPriceEnv : priceEnv;
    if (!env) {
      throw new BadRequestException(`${plan} is not a purchasable plan`);
    }
    const id = this.config.get<string>(env);
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
    const aiTokens = await this.quota.aiTokenUsage(organizationId);
    // `plan` alone is not "has a plan": new orgs default to STARTER with no
    // subscription. `subscribed` is the truth the UI should key off.
    const subscribed =
      !planRequiresSubscription(org.plan) ||
      (org.subscriptionStatus !== null &&
        ACTIVE_SUBSCRIPTION_STATUSES.includes(org.subscriptionStatus));
    return {
      plan: org.plan,
      limits: PLANS[org.plan],
      status: org.subscriptionStatus,
      subscribed,
      currentPeriodEnd: org.currentPeriodEnd,
      hasCustomer: Boolean(org.stripeCustomerId),
      usage,
      aiTokens,
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
    interval: 'month' | 'year' = 'month',
  ): Promise<{ url: string }> {
    const customerId = await this.ensureCustomer(organizationId);
    const base = this.webBase();
    // Card-gated free trial, but only on the org's FIRST subscription — a
    // returning org (any prior status, incl. canceled) pays from day one, so
    // cancel/resubscribe can't chain trials.
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { subscriptionStatus: true },
    });
    const trialEligible = org?.subscriptionStatus == null;
    const session = await this.client().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: this.priceIdFor(plan, interval), quantity: 1 }],
      success_url: `${base}/dashboard/billing?checkout=success`,
      cancel_url: `${base}/dashboard/billing?checkout=cancel`,
      client_reference_id: organizationId,
      payment_method_collection: 'always',
      subscription_data: {
        metadata: { organizationId },
        ...(trialEligible
          ? {
              trial_period_days: TRIAL_DAYS,
              trial_settings: {
                end_behavior: { missing_payment_method: 'cancel' },
              },
            }
          : {}),
      },
      allow_promotion_codes: true,
    });
    if (!session.url) throw new BadRequestException('Could not start checkout');
    return { url: session.url };
  }

  /**
   * Checkout for a one-off AI token pack. `mode: 'payment'` rather than a
   * subscription: the balance carries over, so there is nothing to renew.
   * The org id rides in metadata for the webhook to credit.
   */
  async createTokenCheckout(organizationId: string): Promise<{ url: string }> {
    const price = this.config.get<string>(TOKEN_PACK.priceEnv);
    if (!price) {
      throw new BadRequestException('Token packs are not configured');
    }
    const customerId = await this.ensureCustomer(organizationId);
    const base = this.webBase();
    const session = await this.client().checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url: `${base}/dashboard/billing?checkout=tokens`,
      cancel_url: `${base}/dashboard/billing?checkout=cancel`,
      client_reference_id: organizationId,
      metadata: { organizationId, tokenPack: String(TOKEN_PACK.tokens) },
    });
    if (!session.url) throw new BadRequestException('Could not start checkout');
    return { url: session.url };
  }

  /** Create a Customer Portal session (manage/cancel/update card). */
  async createPortalSession(organizationId: string): Promise<{ url: string }> {
    const customerId = await this.ensureCustomer(organizationId);
    // Our portal configuration is created via the API (not the Dashboard), so
    // it isn't the account default and must be referenced explicitly.
    const configuration = this.config.get<string>('STRIPE_PORTAL_CONFIG');
    const session = await this.client().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.webBase()}/dashboard/billing`,
      ...(configuration ? { configuration } : {}),
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
        // A token pack is a one-off payment, not a subscription.
        const packTokens = Number(session.metadata?.tokenPack ?? 0);
        const orgId = session.metadata?.organizationId;
        if (session.mode === 'payment' && packTokens > 0 && orgId) {
          const credited = await this.quota.creditAiTokens(orgId, {
            tokens: packTokens,
            amountCents: session.amount_total ?? 0,
            currency: session.currency ?? 'usd',
            stripeSessionId: session.id,
          });
          this.log.log(
            credited
              ? `Credited ${packTokens} AI tokens to ${orgId}`
              : `Token pack ${session.id} already credited — ignoring replay`,
          );
          break;
        }
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
      case 'customer.subscription.trial_will_end': {
        // Fires ~3 days before the trial converts into a paid subscription.
        await this.sendTrialEndingReminder(event.data.object);
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
    if (org.plan === 'SPONSORED') {
      // Comped orgs are managed manually — never let a Stripe event demote one.
      this.log.warn(`Ignoring subscription event for sponsored org ${org.id}`);
      return;
    }

    const priceId = sub.items.data[0]?.price.id;
    const plan =
      planForPriceId(priceId, process.env) ??
      // deleted/canceled subs keep the last known tier
      org.plan;
    const canceled = sub.status === 'canceled';
    const periodEnd = sub.items.data[0]?.current_period_end;

    // First PAID activation → X ads conversion. `trialing` doesn't count as
    // "was paying", so trial→active (the first real charge) fires it, while
    // past_due→active dunning recoveries and renewals don't. Dedup-safe via
    // conversion_id = subscription id.
    const wasPaying =
      org.subscriptionStatus === 'active' ||
      org.subscriptionStatus === 'past_due';
    if (sub.status === 'active' && !wasPaying) {
      this.xConversions.trackSubscription(org.adClickId, sub.id);
    }

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

  /** Email the org owner ahead of the first charge ("we'll remind you"). */
  private async sendTrialEndingReminder(
    sub: Stripe.Subscription,
  ): Promise<void> {
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
    if (!org) return;
    const owner = await this.prisma.membership.findFirst({
      where: { organizationId: org.id, role: 'OWNER' },
      include: { user: true },
    });
    if (!owner) return;
    const plan = planForPriceId(sub.items.data[0]?.price.id, process.env);
    await this.mail.sendTrialEnding({
      to: owner.user.email,
      locale: owner.user.locale,
      planLabel: plan ? PLANS[plan].label : org.plan,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : new Date(),
      billingUrl: `${this.webBase()}/dashboard/billing`,
    });
  }
}
