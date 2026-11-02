const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  nodeEnv: env.NODE_ENV ?? 'development',
  logLevel: env.LOG_LEVEL ?? 'info',
  databaseUrl:
    env.DATABASE_URL ?? 'postgres://billsplit:billsplit@localhost:5432/billsplit',
  jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '30d',
  appUrl: (env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  // Cloudflare Access single sign-on. Both empty = disabled (plain e-mail/password login only).
  access: {
    teamDomain: (env.ACCESS_TEAM_DOMAIN ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    aud: env.ACCESS_AUD ?? '',
  },
  // App administrators (comma separated e-mails): may edit the Cloudflare Access allowlist in the app.
  adminEmails: (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  // Cloudflare API access for the allowlist. The token is the only secret (CF_API_TOKEN in .env);
  // the ids are in cloudflare-access.env.
  cloudflare: {
    apiToken: env.CF_API_TOKEN ?? '',
    accountId: env.ACCESS_ACCOUNT_ID ?? '',
    appId: env.ACCESS_APP_ID ?? '',
    policyId: env.ACCESS_POLICY_ID ?? '',
  },
  // One-off import of a Splitwise export when the API starts (README > Εισαγωγή από Splitwise).
  // Set IMPORT_SPLITWISE_FILE (inside the container) to enable; the file is applied only once.
  importSplitwise: {
    file: env.IMPORT_SPLITWISE_FILE ?? '',
    group: env.IMPORT_SPLITWISE_GROUP || undefined,
    users: env.IMPORT_SPLITWISE_USERS || undefined,
    by: env.IMPORT_SPLITWISE_BY || undefined,
    dryRun: ['1', 'true', 'yes'].includes((env.IMPORT_SPLITWISE_DRY_RUN ?? '').toLowerCase()),
  },
  smtp: {
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 587),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.SMTP_FROM ?? 'Bill Split <no-reply@example.com>',
  },
};

