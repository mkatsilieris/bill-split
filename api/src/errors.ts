import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (msg = 'Δεν βρέθηκε') => new HttpError(404, msg);
export const forbidden = (msg = 'Δεν έχετε δικαίωμα') => new HttpError(403, msg);
export const badRequest = (msg: string) => new HttpError(400, msg);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path?.join('.');
    const prefix = path ? `${path}: ` : '';
    res.status(400).json({ error: `${prefix}${first?.message ?? 'Μη έγκυρα δεδομένα'}` });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Κάτι πήγε στραβά' });
}
