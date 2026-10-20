function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const production = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.API_PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  operatorDatabaseUrl: required('DATABASE_OPERATOR_URL'),
  sessionSecret: required('SESSION_SECRET'),
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:8080',
  redis: { host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6379) },
  /** Demo user picker. Never on in production. */
  devSignIn: process.env.DEV_SIGN_IN === 'true' && !production,
  /** Test-only seeding and clock endpoints used by the Playwright suite. Never on in production. */
  testApi: process.env.TEST_API === 'true' && !production,
  secureCookies: production,
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  sentryDsn: process.env.SENTRY_DSN,
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
};
