import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { migrate, waitForDb } from './db.js';
import { errorHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { groupsRouter } from './routes/groups.js';

const app = express();
app.disable('x-powered-by');
// Behind nginx (and Cloudflare): take the client IP / protocol from X-Forwarded-* headers.
app.set('trust proxy', 1);
// The SPA is served from the same origin, so only APP_URL (and localhost in dev) may call the API cross-origin.
const allowedOrigins = new Set([config.appUrl, ...(config.nodeEnv === 'production' ? [] : ['http://localhost:5173'])]);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)) }));
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/groups', groupsRouter);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(errorHandler);

async function main() {
  await waitForDb();
  await migrate();
  app.listen(config.port, () => {
    console.log(`[api] listening on :${config.port} (${config.nodeEnv})`);
  });
}

main().catch((err) => {
  console.error('[api] fatal:', err);
  process.exit(1);
});
