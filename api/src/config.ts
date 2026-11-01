const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  nodeEnv: env.NODE_ENV ?? 'development',
  databaseUrl:
    env.DATABASE_URL ?? 'postgres://billsplit:billsplit@localhost:5432/billsplit',
  jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? '30d',
  appUrl: (env.APP_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  smtp: {
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 587),
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.SMTP_FROM ?? 'Bill Split <no-reply@example.com>',
  },
};

if (config.nodeEnv === 'production' && config.jwtSecret === 'dev-secret-change-me') {
  console.warn('[config] WARNING: JWT_SECRET is using the default value. Set it in .env!');
}
