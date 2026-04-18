import { Request, Response, NextFunction } from 'express';
import { createOAuthClient } from '../services/googleAuth';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = (req as any).session;
  if (!session?.tokens) {
    res.status(401).json({ error: 'Not authenticated. Visit /api/auth/google to sign in.' });
    return;
  }
  const client = createOAuthClient();
  client.setCredentials(session.tokens);
  (req as any).oauthClient = client;
  next();
}
