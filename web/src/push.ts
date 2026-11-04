import { api, getToken } from './api';

// Endpoint of the subscription this browser registered for the signed-in account. Cleared on
// logout, so the next account on the same device starts with notifications off.
const ENDPOINT_KEY = 'billsplit.pushEndpoint';

function readEndpoint(): string | null {
  try {
    return localStorage.getItem(ENDPOINT_KEY);
  } catch {
    return null;
  }
}

function writeEndpoint(endpoint: string | null): void {
  try {
    if (endpoint) localStorage.setItem(ENDPOINT_KEY, endpoint);
    else localStorage.removeItem(ENDPOINT_KEY);
  } catch {
    /* storage unavailable */
  }
}

export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iPhone / iPad in a Safari tab: push works only after "Add to Home Screen". */
export const needsHomeScreen = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

async function browserSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

function toKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function register(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  await api('/push/subscribe', { method: 'POST', body: { endpoint: json.endpoint, keys: json.keys } });
  writeEndpoint(sub.endpoint);
}

/** True when this device receives notifications for the signed-in account. */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const sub = await browserSubscription();
  return Boolean(sub && sub.endpoint === readEndpoint());
}

export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Οι ειδοποιήσεις δεν επιτράπηκαν. Ενεργοποιήστε τες από τις ρυθμίσεις του browser για αυτή τη σελίδα.');
  }
  const { publicKey } = await api<{ publicKey: string }>('/push/key');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  await register(sub);
}

export async function disablePush(): Promise<void> {
  const sub = await browserSubscription();
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
  writeEndpoint(null);
}

/**
 * Re-sends this device's subscription after sign-in: the browser may have renewed it (new
 * endpoint) since it was registered. Does nothing on a device where notifications are off.
 */
export async function resyncPush(): Promise<void> {
  if (!pushSupported() || !readEndpoint() || Notification.permission !== 'granted') return;
  try {
    const sub = await browserSubscription();
    if (sub) await register(sub);
    else writeEndpoint(null);
  } catch {
    /* next sign-in tries again */
  }
}

/**
 * Logout: stop notifications of this account on this device. Synchronous on purpose (the page may
 * navigate away right after), so it uses the stored endpoint and a keepalive request.
 */
export function forgetPushDevice(): void {
  const endpoint = readEndpoint();
  const token = getToken();
  writeEndpoint(null);
  if (!endpoint || !token) return;
  void fetch('/api/push/unsubscribe', {
    method: 'POST',
    keepalive: true,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
}
