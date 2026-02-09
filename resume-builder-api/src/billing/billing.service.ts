import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { getPlanConfig, type PlanName } from './plan-limits';
import { resetUsageForPlan } from './usage';

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.stripe = new Stripe(this.config.get<string>('STRIPE_SECRET_KEY', ''), {
      apiVersion: '2026-01-28.clover',
    });
  }

  async createCheckoutSession(userId: string, plan: PlanName) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ForbiddenException('User not found');
    }

    const priceId = plan === 'STUDENT'
      ? this.config.get<string>('STRIPE_PRICE_STUDENT', '')
      : this.config.get<string>('STRIPE_PRICE_PRO', '');

    if (!priceId) {
      throw new ForbiddenException('Stripe price not configured');
    }

    const customerId = user.stripeCustomerId || (await this.createCustomer(user));

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: this.config.get<string>('STRIPE_SUCCESS_URL', 'http://localhost:3000/dashboard'),
      cancel_url: this.config.get<string>('STRIPE_CANCEL_URL', 'http://localhost:3000/dashboard'),
      metadata: { userId, plan },
    });

    return { url: session.url };
  }

  async createPortalSession(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.stripeCustomerId) {
      throw new ForbiddenException('No Stripe customer found');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: this.config.get<string>('STRIPE_SUCCESS_URL', 'http://localhost:3000/dashboard'),
    });

    return { url: session.url };
  }

  async handleWebhook(req: any, signature: string) {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET', '');
    let event: Stripe.Event;
    try {
      const rawBody = req.rawBody || req.body;
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.customer && session.metadata?.userId) {
          await this.prisma.user.update({
            where: { id: session.metadata.userId },
            data: {
              stripeCustomerId: String(session.customer),
            },
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.applySubscription(subscription);
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.cancelSubscription(subscription);
        break;
      }
      default:
        break;
    }

    return { received: true };
  }

  private async createCustomer(user: { id: string; email: string; fullName: string }) {
    const customer = await this.stripe.customers.create({
      email: user.email,
      name: user.fullName,
      metadata: { userId: user.id },
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  private async applySubscription(subscription: Stripe.Subscription) {
    const customerId = String(subscription.customer);
    const user = await this.prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
    if (!user) return;

    const priceId = subscription.items.data[0]?.price?.id || '';
    const plan = priceId === this.config.get<string>('STRIPE_PRICE_STUDENT', '') ? 'STUDENT' : 'PRO';
    const planConfig = getPlanConfig(plan);
    const itemPeriodEnd = subscription.items.data[0]?.current_period_end;
    const currentPeriodEnd = new Date((itemPeriodEnd ?? Math.floor(Date.now() / 1000)) * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan,
        stripeSubscriptionId: subscription.id,
        stripeCurrentPeriodEnd: currentPeriodEnd,
        aiTokensLimit: planConfig.aiTokensLimit,
        pdfExportsLimit: planConfig.pdfExportsLimit,
        atsScansLimit: planConfig.atsScansLimit,
        resumesLimit: planConfig.resumesLimit,
      },
    });

    await resetUsageForPlan(this.prisma, user.id, plan, currentPeriodEnd);
  }

  private async cancelSubscription(subscription: Stripe.Subscription) {
    const customerId = String(subscription.customer);
    const user = await this.prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
    if (!user) return;

    const planConfig = getPlanConfig('FREE');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: 'FREE',
        stripeSubscriptionId: null,
        stripeCurrentPeriodEnd: null,
        aiTokensLimit: planConfig.aiTokensLimit,
        pdfExportsLimit: planConfig.pdfExportsLimit,
        atsScansLimit: planConfig.atsScansLimit,
        resumesLimit: planConfig.resumesLimit,
      },
    });

    await resetUsageForPlan(this.prisma, user.id, 'FREE');
  }
}
