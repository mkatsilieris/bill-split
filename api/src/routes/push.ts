import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { pool } from '../db.js';
import { HttpError } from '../errors.js';
import { notifyUsers, pushPublicKey } from '../push.js';

export const pushRouter = Router();
pushRouter.use(requireAuth);

const endpoint = z.string().url().max(2000);

/** The key the browser needs to subscribe (applicationServerKey). */
pushRouter.get('/key', (_req, res) => {
  const key = pushPublicKey();
  if (!key) throw new HttpError(503, 'Οι ειδοποιήσεις δεν είναι διαθέσιμες');
  res.json({ publicKey: key });
});

/** Turns notifications on for this device. A device another account used before moves to this one. */
pushRouter.post('/subscribe', async (req, res) => {
  const body = z
    .object({
      endpoint,
      keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
    })
    .parse(req.body);
  const userAgent = (req.headers['user-agent'] ?? '').slice(0, 300) || null;
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent, deleted_at = NULL, deleted_by = NULL`,
    [req.user.id, body.endpoint, body.keys.p256dh, body.keys.auth, userAgent],
  );
  req.log.info({ user: req.user.id }, 'push: device subscribed');
  res.status(201).json({ ok: true });
});

/** Turns notifications off for this device (also called on logout). */
pushRouter.post('/unsubscribe', async (req, res) => {
  const body = z.object({ endpoint }).parse(req.body);
  await pool.query(
    `UPDATE push_subscriptions SET deleted_at = now(), deleted_by = $2
      WHERE endpoint = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [body.endpoint, req.user.id],
  );
  req.log.info({ user: req.user.id }, 'push: device unsubscribed');
  res.status(204).end();
});

/** Sends a test notification to every device of the caller. */
pushRouter.post('/test', async (req, res) => {
  await notifyUsers([req.user.id], {
    title: 'Bill Split',
    body: 'Οι ειδοποιήσεις λειτουργούν σε αυτή τη συσκευή.',
    url: '/profile',
    tag: 'test',
  });
  res.json({ ok: true });
});
