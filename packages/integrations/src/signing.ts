import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** GitHub: `X-Hub-Signature-256: sha256=<hex hmac of the raw body>`. */
export function signGitHub(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifyGitHub(secret: string, body: string, signature: string | undefined): boolean {
  return !!signature && safeEqual(signGitHub(secret, body), signature);
}

/** Stripe: `Stripe-Signature: t=<unix>,v1=<hex hmac of "t.body">`, with a five minute tolerance. */
export function signStripe(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

export function verifyStripe(secret: string, body: string, header: string | undefined, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const timestamp = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return safeEqual(expected, parts.v1);
}

/** Shopify: `X-Shopify-Hmac-Sha256: <base64 hmac of the raw body>`. */
export function signShopify(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

export function verifyShopify(secret: string, body: string, signature: string | undefined): boolean {
  return !!signature && safeEqual(signShopify(secret, body), signature);
}
