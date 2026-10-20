import { schema, type Db } from '@higgsden/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { config } from '../config.js';

export function createAuth(db: Db) {
  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
  if (config.github.clientId && config.github.clientSecret) socialProviders.github = { clientId: config.github.clientId, clientSecret: config.github.clientSecret };
  if (config.google.clientId && config.google.clientSecret) socialProviders.google = { clientId: config.google.clientId, clientSecret: config.google.clientSecret };

  return betterAuth({
    baseURL: config.publicUrl,
    basePath: '/api/auth',
    secret: config.sessionSecret,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: { user: schema.users, session: schema.authSessions, account: schema.authAccounts, verification: schema.authVerifications },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
    socialProviders,
    user: { additionalFields: { isOperator: { type: 'boolean', input: false, defaultValue: false, required: false } } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    trustedOrigins: [config.publicUrl],
    rateLimit: { enabled: !config.testApi && !config.devSignIn },
    advanced: {
      cookiePrefix: 'higgsden',
      useSecureCookies: config.secureCookies,
      database: { generateId: 'uuid' },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export function enabledSocialProviders(): string[] {
  return [config.github.clientId ? 'github' : null, config.google.clientId ? 'google' : null].filter(Boolean) as string[];
}
