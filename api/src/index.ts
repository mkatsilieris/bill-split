import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { migrate, waitForDb } from './db.js';
import { errorHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { groupsRouter } from './routes/groups.js';

const app = express();
app.disable('x-powered-by');
app.use(cors());
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
