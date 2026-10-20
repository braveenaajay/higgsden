import type { Role, SubscriptionState } from '@higgsden/policy';
import type { FastifyRequest } from 'fastify';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isOperator: boolean;
}

export interface Tenant {
  userId: string;
  agencyId: string;
  agencySlug: string;
  membershipId: string;
  role: Role;
  assignedClientIds: string[];
  subscriptionState: SubscriptionState;
}

export type AppRequest = FastifyRequest & { user?: SessionUser; tenant?: Tenant; rawBody?: Buffer };

export function webHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return headers;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
