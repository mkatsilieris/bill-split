import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { accessEnabled } from './access.js';
import { allowlistEnabled } from './cloudflare.js';
import { mailConfigured } from './mail.js';
import { migrate, waitForDb } from './db.js';
import { errorHandler } from './errors.js';
import { log, requestLogger } from './log.js';
import { authRouter } from './routes/auth.js';
import { groupsRouter } from './routes/groups.js';
import { adminRouter } from './routes/admin.js';
import { pushRouter } from './routes/push.js';
import { tokensRouter } from './routes/tokens.js';
import { mcpRouter } from './routes/mcp.js';
import { initPush, pushPublicKey } from './push.js';
import { importSplitwise } from './import.js';

const app = express();
app.disable('x-powered-by');
// Behind nginx (and Cloudflare): take the client IP / protocol from X-Forwarded-* headers.
app.set('trust proxy', 1);
// The SPA is served from the same origin, so only APP_URL (and localhost in dev) may call the API cross-origin.
const allowedOrigins = new Set([config.appUrl, ...(config.nodeEnv === 'production' ? [] : ['http://localhost:5173'])]);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)) }));
app.use(requestLogger);
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/push', pushRouter);
app.use('/api/tokens', tokensRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(errorHandler);

async function main() {
  if (config.nodeEnv === 'production' && config.jwtSecret === 'dev-secret-change-me') {
    log.warn('JWT_SECRET is using the default value. Set it in .env!');
  }
  await waitForDb();
  await migrate();
  await initPush();
  app.listen(config.port, () => {
    log.info({ port: config.port, env: config.nodeEnv, logLevel: config.logLevel }, 'api listening');
    // One line that answers "is it configured?" without reading .env on the server.
    log.info(
      {
        cloudflareAccessSso: accessEnabled,
        allowlistAdmin: allowlistEnabled,
        smtp: mailConfigured,
        push: Boolean(pushPublicKey()),
        admins: config.adminEmails.length,
        timeZone: config.timeZone,
      },
      'features',
    );
    void runStartupImport();
  });
}

/** Applies IMPORT_SPLITWISE_FILE once (the file's hash is remembered); a failure never stops the API. */
async function runStartupImport() {
  const opts = config.importSplitwise;
  if (!opts.file) return;
  try {
    const summary = await importSplitwise(opts);
    log.info({ import: summary }, opts.dryRun ? 'splitwise import: dry run, nothing written' : 'splitwise import done');
  } catch (err) {
    log.error({ err, file: opts.file }, 'splitwise import failed');
  }
}

main().catch((err) => {
  log.fatal({ err }, 'api failed to start');
  process.exit(1);
});

process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled promise rejection'));
process.on('SIGTERM', () => {
  log.info('shutting down');
  process.exit(0);
});
