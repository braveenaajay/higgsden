import Stripe from 'stripe';
import type { Sandbox } from './sandbox.js';
import { signStripe } from './signing.js';

export interface InvoiceLine {
  description: string;
  quantity: number;
  amountCents: number;
}

export interface BillingProvider {
  readonly mode: 'fake' | 'real';
  createCustomer(input: { agencyId: string; name: string; email: string }): Promise<{ customerId: string }>;
  checkoutUrl(input: { customerId: string; planCode: string; priceId: string | null; successUrl: string; cancelUrl: string }): Promise<string>;
  /** Sends usage to a Stripe meter. `identifier` makes the call idempotent. */
  reportUsage(input: { customerId: string; meter: string; quantity: number; identifier: string }): Promise<void>;
  createInvoice(input: { customerId: string; period: string; lines: InvoiceLine[] }): Promise<{ invoiceId: string; status: string; totalCents: number }>;
}

export interface FakeStripeOptions {
  publicApiUrl: string;
  webhookUrl: string;
  webhookSecret: string;
}

/** Test-mode stand-in. Checkout is a local page, and subscription changes arrive as signed webhooks. */
export class FakeStripe implements BillingProvider {
  readonly mode = 'fake' as const;

  constructor(
    private readonly sandbox: Sandbox,
    private readonly options: FakeStripeOptions,
  ) {}

  async createCustomer(input: { agencyId: string; name: string; email: string }) {
    const customerId = `cus_fake_${input.agencyId.replaceAll('-', '').slice(0, 14)}`;
    await this.sandbox.put('stripe_customer', customerId, input);
    return { customerId };
  }

  async checkoutUrl(input: { customerId: string; planCode: string }) {
    const q = new URLSearchParams({ customer: input.customerId, plan: input.planCode });
    return `${this.options.publicApiUrl}/api/billing/fake-checkout?${q}`;
  }

  async reportUsage(input: { customerId: string; meter: string; quantity: number; identifier: string }) {
    await this.sandbox.create('stripe_meter_event', input.identifier, input);
  }

  async createInvoice(input: { customerId: string; period: string; lines: InvoiceLine[] }) {
    const invoiceId = `in_fake_${input.customerId.slice(-8)}_${input.period.replace('-', '')}`;
    const totalCents = input.lines.reduce((sum, l) => sum + l.amountCents, 0);
    await this.sandbox.put('stripe_invoice', invoiceId, { ...input, totalCents });
    return { invoiceId, status: 'draft', totalCents };
  }

  /** Delivers a signed event to the API, as Stripe would. */
  async deliver(type: string, object: Record<string, unknown>): Promise<number> {
    const body = JSON.stringify({ id: `evt_fake_${crypto.randomUUID()}`, type, data: { object }, created: Math.floor(Date.now() / 1000) });
    const res = await fetch(this.options.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signStripe(this.options.webhookSecret, body) },
      body,
    });
    return res.status;
  }
}

export class RealStripe implements BillingProvider {
  readonly mode = 'real' as const;
  private readonly stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createCustomer(input: { agencyId: string; name: string; email: string }) {
    const customer = await this.stripe.customers.create(
      { name: input.name, email: input.email, metadata: { agency_id: input.agencyId } },
      { idempotencyKey: `customer-${input.agencyId}` },
    );
    return { customerId: customer.id };
  }

  async checkoutUrl(input: { customerId: string; planCode: string; priceId: string | null; successUrl: string; cancelUrl: string }) {
    if (!input.priceId) throw new Error(`Plan ${input.planCode} has no Stripe price id`);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe returned no checkout url');
    return session.url;
  }

  async reportUsage(input: { customerId: string; meter: string; quantity: number; identifier: string }) {
    await this.stripe.billing.meterEvents.create({
      event_name: input.meter,
      identifier: input.identifier,
      payload: { stripe_customer_id: input.customerId, value: String(input.quantity) },
    });
  }

  async createInvoice(input: { customerId: string; period: string; lines: InvoiceLine[] }) {
    const invoice = await this.stripe.invoices.create({ customer: input.customerId, auto_advance: false, metadata: { period: input.period } });
    for (const line of input.lines) {
      await this.stripe.invoiceItems.create({ customer: input.customerId, invoice: invoice.id, amount: line.amountCents, currency: 'usd', description: line.description });
    }
    const refreshed = await this.stripe.invoices.retrieve(invoice.id!);
    return { invoiceId: refreshed.id!, status: refreshed.status ?? 'draft', totalCents: refreshed.total };
  }
}
