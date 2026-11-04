import webpush, { WebPushError, type PushSubscription } from 'web-push';
import { config } from './config.js';
import { pool } from './db.js';
import { log } from './log.js';

/**
 * Web Push (phone / browser notifications). The VAPID key pair identifies this server to the push
 * services (Google, Apple, Mozilla). It comes from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when both
 * are set, otherwise it is created on the first start and kept in app_secrets, so nothing has to
 * be configured. Changing the keys invalidates every subscription (each device turns it on again).
 */
interface Vapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

let vapid: Vapid | null = null;

export async function initPush(): Promise<void> {
  let { publicKey, privateKey } = config.push;
  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    await pool.query(
      `INSERT INTO app_secrets (name, value) VALUES ('vapid_public_key', $1), ('vapid_private_key', $2)
       ON CONFLICT (name) DO NOTHING`,
      [generated.publicKey, generated.privateKey],
    );
    const { rows } = await pool.query<{ name: string; value: string }>(
      `SELECT name, value FROM app_secrets WHERE name IN ('vapid_public_key', 'vapid_private_key')`,
    );
    const stored = new Map(rows.map((r) => [r.name, r.value]));
    publicKey = stored.get('vapid_public_key')!;
    privateKey = stored.get('vapid_private_key')!;
  }
  // Apple rejects a subject that is not a mailto: or https: URL.
  const subject =
    config.push.subject ||
    (config.adminEmails[0] ? `mailto:${config.adminEmails[0]}` : config.appUrl.startsWith('https:') ? config.appUrl : '');
  if (!subject) log.warn('push: no VAPID subject (set VAPID_SUBJECT or ADMIN_EMAILS); Apple devices may refuse notifications');
  vapid = { subject: subject || 'mailto:admin@localhost', publicKey, privateKey };
}

export function pushPublicKey(): string | null {
  return vapid?.publicKey ?? null;
}

export interface PushMessage {
  title: string;
  body: string;
  /** page the notification opens, e.g. /groups/3 */
  url: string;
  /** notifications with the same tag replace each other instead of piling up */
  tag?: string;
}

interface SubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sends the message to every active device of the given users. Never throws: a notification that
 * cannot be delivered must not break the action that caused it. Expired subscriptions are turned off.
 */
export async function notifyUsers(userIds: number[], message: PushMessage): Promise<void> {
  if (!vapid || userIds.length === 0) return;
  try {
    const { rows } = await pool.query<SubscriptionRow>(
      `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions
        WHERE user_id = ANY($1::int[]) AND deleted_at IS NULL`,
      [userIds],
    );
    const payload = JSON.stringify(message);
    await Promise.all(rows.map((row) => send(row, payload)));
  } catch (err) {
    log.error({ err }, 'push: sending notifications failed');
  }
}

async function send(row: SubscriptionRow, payload: string): Promise<void> {
  const subscription: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
  try {
    await webpush.sendNotification(subscription, payload, {
      vapidDetails: vapid!,
      TTL: 24 * 60 * 60, // keep trying for a day if the phone is off
      urgency: 'normal',
    });
    await pool.query('UPDATE push_subscriptions SET last_sent_at = now() WHERE id = $1', [row.id]);
  } catch (err) {
    const status = err instanceof WebPushError ? err.statusCode : undefined;
    if (status === 404 || status === 410) {
      // the person removed the permission or reinstalled the app: this subscription is gone for good
      await pool.query('UPDATE push_subscriptions SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [row.id]);
      log.info({ user: row.user_id, subscription: row.id, status }, 'push: subscription expired, turned off');
    } else {
      log.warn(
        { user: row.user_id, subscription: row.id, status, reason: err instanceof WebPushError ? err.body : (err as Error).message },
        'push: notification not delivered',
      );
    }
  }
}
