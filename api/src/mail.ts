import nodemailer from 'nodemailer';
import { config } from './config.js';
import { log } from './log.js';

const smtpConfigured = Boolean(config.smtp.host);

const transport = smtpConfigured
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    })
  : null;

export const mailConfigured = smtpConfigured;

/** The message a new member receives (also shown to the admin to forward by hand when SMTP is off). */
export function invitationText(to: string, inviterName: string): string {
  return (
    `${inviterName} σας πρόσθεσε στο Bill Split, την εφαρμογή για τα κοινά έξοδα.\n\n` +
    `Ανοίξτε: ${config.appUrl}\n\n` +
    `Στη σελίδα σύνδεσης γράψτε αυτό το email (${to}). Θα λάβετε έναν κωδικό μίας χρήσης, ` +
    'τον γράφετε και μπαίνετε. Δεν χρειάζεται εγγραφή ούτε κωδικός πρόσβασης.\n\n' +
    'Στο κινητό, από το μενού του browser επιλέξτε «Προσθήκη στην αρχική οθόνη» για να το έχετε σαν εφαρμογή.'
  );
}

/** Returns true when the e-mail was handed to the SMTP server, false when SMTP is not configured. */
export async function sendInvitation(to: string, inviterName: string): Promise<boolean> {
  const text = invitationText(to, inviterName);
  if (!transport) {
    log.warn({ email: to }, 'SMTP not configured - invitation e-mail not sent');
    return false;
  }
  await transport.sendMail({ from: config.smtp.from, to, subject: 'Πρόσκληση στο Bill Split', text });
  log.info({ email: to }, 'invitation e-mail sent');
  return true;
}

export async function sendPasswordReset(to: string, resetUrl: string): Promise<void> {
  const subject = 'Επαναφορά κωδικού - Bill Split';
  const text =
    'Λάβαμε αίτημα επαναφοράς κωδικού για τον λογαριασμό σας.\n\n' +
    `Πατήστε τον παρακάτω σύνδεσμο (ισχύει για 1 ώρα):\n${resetUrl}\n\n` +
    'Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το email.';

  if (!transport) {
    log.warn({ email: to, resetUrl }, 'SMTP not configured - the password reset link is only in this log line');
    return;
  }
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
  log.info({ email: to }, 'password reset e-mail sent');
}
