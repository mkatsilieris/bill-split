import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { isAdmin, requireAdmin, requireAuth } from '../auth.js';
import { HttpError, badRequest } from '../errors.js';
import { allowlistEnabled, getAllowlist, revokeAccessSession, setAllowlist } from '../cloudflare.js';
import { invitationText, mailConfigured, sendInvitation } from '../mail.js';

/**
 * Administration of who may reach the app from the Internet. The list lives in Cloudflare (the
 * e-mail rules of the Access policy); the app only reads and edits it, so the Cloudflare dashboard
 * and this page always agree.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

const email = z.string().trim().toLowerCase().email('Μη έγκυρο email');

function ensureConfigured(): void {
  if (!allowlistEnabled) {
    throw new HttpError(503, 'Δεν έχει ρυθμιστεί η σύνδεση με το Cloudflare (CF_API_TOKEN στο .env του server)');
  }
}

adminRouter.get('/allowlist', async (_req, res) => {
  ensureConfigured();
  res.json({ emails: await getAllowlist(), mail_configured: mailConfigured });
});

/** Adds an e-mail to the allowlist and e-mails the person how to get in. */
adminRouter.post('/allowlist', async (req, res) => {
  ensureConfigured();
  const body = z.object({ email }).parse(req.body);
  const current = await getAllowlist();
  if (current.includes(body.email)) throw new HttpError(409, 'Το email είναι ήδη στη λίστα');

  const emails = await setAllowlist([...current, body.email]);
  req.log.info({ email: body.email, by: req.user.id }, 'added to the cloudflare access allowlist');

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [req.user.id]);
  const inviter = rows[0]?.name ?? req.user.email;
  let mailSent = false;
  try {
    mailSent = await sendInvitation(body.email, inviter);
  } catch (err) {
    req.log.error({ err, email: body.email }, 'failed to send the invitation e-mail');
  }
  res.status(201).json({ emails, mail_sent: mailSent, invitation_text: invitationText(body.email, inviter) });
});

/** Removes an e-mail from the allowlist and, when the token allows it, ends their Access session. */
adminRouter.delete('/allowlist/:email', async (req, res) => {
  ensureConfigured();
  const target = email.parse(decodeURIComponent(req.params.email));
  if (target === req.user.email) throw badRequest('Δεν μπορείτε να αφαιρέσετε τον εαυτό σας');
  if (isAdmin(target)) throw badRequest('Οι διαχειριστές αφαιρούνται μόνο από το ADMIN_EMAILS του server');

  const current = await getAllowlist();
  if (!current.includes(target)) throw new HttpError(404, 'Το email δεν είναι στη λίστα');

  const emails = await setAllowlist(current.filter((e) => e !== target));
  const revoked = await revokeAccessSession(target);
  req.log.info({ email: target, by: req.user.id, revoked }, 'removed from the cloudflare access allowlist');
  res.json({ emails, revoked });
});
