import { Body, Controller, Get, HttpCode, NotFoundException, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { audit, notify, resolveAgency, schema as s } from '@higgsden/db';
import { billingPeriod, periodStart, spendPercent } from '@higgsden/domain';
import { FakeStripe, verifyStripe } from '@higgsden/integrations';
import type { SubscriptionState } from '@higgsden/policy';
import { asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { SessionGuard } from '../auth/session.guard.js';
import type { AppRequest, Tenant } from '../auth/session.js';
import { BillingArea, CurrentTenant, TenantGuard } from '../auth/tenant.guard.js';
import { agencyWithPlan, clientUse, seatUse } from '../agency/agency.controller.js';
import { assertCan, parse } from '../common/access.js';
import { ProvidersService } from '../common/providers.service.js';
import { config } from '../config.js';
import { DbService } from '../db/db.service.js';

const STATE_FROM_STRIPE: Record<string, SubscriptionState> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete: 'past_due',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
};

@Controller('agencies/:agencyId/billing')
@UseGuards(SessionGuard, TenantGuard)
@BillingArea()
export class BillingController {
  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  billing(@CurrentTenant() tenant: Tenant) {
    assertCan(tenant, 'billing.manage');
    return this.db.tenant(tenant, async (tx) => {
      const { agency, plan } = await agencyWithPlan(tx, tenant.agencyId);
      const plans = await tx.select().from(s.plans).orderBy(asc(s.plans.monthlyPriceCents));
      const invoices = await tx.select().from(s.invoices).orderBy(desc(s.invoices.createdAt)).limit(12);
      const [spend] = await tx
        .select({ cents: sql<string>`coalesce(sum(${s.usageRecords.priceCents}), 0)` })
        .from(s.usageRecords)
        .where(gte(s.usageRecords.recordedAt, periodStart()));
      const spendCents = Math.round(Number(spend?.cents ?? 0));
      return {
        plan: { code: plan.code, name: plan.name, seatCap: plan.seatCap, clientCap: plan.clientCap, monthlyPriceCents: plan.monthlyPriceCents },
        plans: plans.filter((p) => p.code !== 'trial').map((p) => ({ code: p.code, name: p.name, seatCap: p.seatCap, clientCap: p.clientCap, monthlyPriceCents: p.monthlyPriceCents })),
        subscriptionState: agency.subscriptionState,
        trialEndsAt: agency.trialEndsAt?.toISOString() ?? null,
        seats: { used: await seatUse(tx, agency.id), cap: plan.seatCap },
        clients: { used: await clientUse(tx, agency.id), cap: plan.clientCap },
        hosting: { period: billingPeriod(), spendCents, capCents: agency.spendCapCents, percent: spendPercent(spendCents, agency.spendCapCents) },
        invoices: invoices.map((i) => ({ id: i.id, period: i.period, status: i.status, totalCents: i.totalCents, lines: i.lines })),
        provider: this.providers.p.billing.mode,
      };
    });
  }

  @Post('checkout')
  checkout(@CurrentTenant() tenant: Tenant, @Body() body: unknown) {
    assertCan(tenant, 'billing.manage');
    const { planCode } = parse(z.object({ planCode: z.string() }), body);
    return this.db.tenant(tenant, async (tx) => {
      const { agency } = await agencyWithPlan(tx, tenant.agencyId);
      const [plan] = await tx.select().from(s.plans).where(eq(s.plans.code, planCode));
      if (!plan || plan.code === 'trial') throw new NotFoundException();
      if (!agency.stripeCustomerId) throw new NotFoundException({ message: 'No billing customer for this Agency' });
      const url = await this.providers.p.billing.checkoutUrl({
        customerId: agency.stripeCustomerId,
        planCode: plan.code,
        priceId: plan.stripePriceId,
        successUrl: `${config.publicUrl}/a/${agency.id}/billing?checkout=success`,
        cancelUrl: `${config.publicUrl}/a/${agency.id}/billing`,
      });
      return { url };
    });
  }
}

@Controller()
export class StripeWebhookController {
  constructor(
    private readonly db: DbService,
    private readonly providers: ProvidersService,
  ) {}

  /** Signed Stripe events. Each event id is processed once. */
  @Post('webhooks/stripe')
  @HttpCode(200)
  async webhook(@Req() req: AppRequest) {
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!verifyStripe(this.providers.p.config.stripeWebhookSecret, raw, req.headers['stripe-signature'] as string | undefined)) {
      throw new UnauthorizedException('Invalid signature');
    }
    const event = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
    const object = event.data.object;
    const customer = String(object.customer ?? '');

    return this.db.tenant({}, async (tx) => {
      const agencyId = customer ? await resolveAgency(tx, 'resolve_stripe_customer', customer) : null;
      const [delivery] = await tx
        .insert(s.webhookDeliveries)
        .values({ provider: 'stripe', deliveryId: event.id, eventType: event.type, agencyId, outcome: agencyId ? 'processed' : 'ignored' })
        .onConflictDoNothing()
        .returning();
      if (!delivery) return { duplicate: true };
      if (!agencyId) return { ignored: true };
      await tx.execute(sql`select set_config('app.agency_id', ${agencyId}, true)`);

      const [agency] = await tx.select().from(s.agencies).where(eq(s.agencies.id, agencyId));
      if (!agency) return { ignored: true };
      let state: SubscriptionState | null = null;
      let planCode: string | null = null;
      if (event.type.startsWith('customer.subscription.')) {
        state = event.type === 'customer.subscription.deleted' ? 'canceled' : (STATE_FROM_STRIPE[String(object.status)] ?? null);
        planCode = (object.metadata as Record<string, string> | undefined)?.plan_code ?? null;
      } else if (event.type === 'invoice.payment_failed') {
        state = 'past_due';
      } else if (event.type === 'invoice.paid' && agency.subscriptionState === 'past_due') {
        state = 'active';
      }

      if (planCode && planCode !== agency.planCode) {
        const [plan] = await tx.select().from(s.plans).where(eq(s.plans.code, planCode));
        if (plan) {
          await tx.update(s.agencies).set({ planCode, spendCapCents: Math.max(agency.spendCapCents, plan.defaultSpendCapCents) }).where(eq(s.agencies.id, agencyId));
          await audit(tx, { agencyId, actorKind: 'webhook', entityType: 'agency', entityId: agencyId, action: 'plan.change', summary: `Plan changed from ${agency.planCode} to ${planCode}` });
        }
      }
      if (state && state !== agency.subscriptionState) {
        await tx
          .update(s.agencies)
          .set({ subscriptionState: state, stripeSubscriptionId: typeof object.id === 'string' && object.id.startsWith('sub_') ? object.id : agency.stripeSubscriptionId })
          .where(eq(s.agencies.id, agencyId));
        await audit(tx, { agencyId, actorKind: 'webhook', entityType: 'agency', entityId: agencyId, action: 'subscription.state_change', summary: `Subscription changed from ${agency.subscriptionState} to ${state}` });
        await notify(tx, { agencyId, kind: 'billing', title: `Subscription is ${state.replace('_', ' ')}`, body: state === 'past_due' ? 'Payment failed. Creating is paused until billing is fixed.' : `The subscription is now ${state}.` });
      }
      return { ok: true };
    });
  }

  /** Local stand-in for Stripe Checkout. Shown only while Stripe runs in fake mode. */
  @Get('billing/fake-checkout')
  fakeCheckout(@Query('customer') customer: string, @Query('plan') plan: string, @Res() reply: FastifyReply) {
    if (!(this.providers.p.billing instanceof FakeStripe)) throw new NotFoundException();
    const esc = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, '');
    reply.type('text/html').send(`<!doctype html><html><head><title>Test checkout</title><meta name="viewport" content="width=device-width">
<style>body{font-family:system-ui;max-width:420px;margin:80px auto;padding:0 16px;color:#18181b}button{background:#635bff;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:15px;cursor:pointer}</style></head>
<body><p style="color:#71717a;font-size:13px">Stripe test mode (local fake)</p><h1>Subscribe to ${esc(plan)}</h1><p>Card 4242 4242 4242 4242 is accepted. Nothing is charged.</p>
<form method="post" action="/api/billing/fake-checkout"><input type="hidden" name="customer" value="${esc(customer)}"><input type="hidden" name="plan" value="${esc(plan)}"><button type="submit">Pay with test card</button></form></body></html>`);
  }

  @Post('billing/fake-checkout')
  async completeFakeCheckout(@Body() body: Record<string, string>, @Res() reply: FastifyReply) {
    const billing = this.providers.p.billing;
    if (!(billing instanceof FakeStripe)) throw new NotFoundException();
    const { customer, plan } = parse(z.object({ customer: z.string().min(1), plan: z.string().min(1) }), body);
    await billing.deliver('customer.subscription.updated', { id: `sub_fake_${customer.slice(-10)}`, customer, status: 'active', metadata: { plan_code: plan } });
    const agencyId = await this.db.tenant({}, (tx) => resolveAgency(tx, 'resolve_stripe_customer', customer));
    reply.redirect(agencyId ? `/a/${agencyId}/billing?checkout=success` : '/', 303);
  }
}
