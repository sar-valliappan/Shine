import { Request, Response, NextFunction } from 'express';
import {
  createOAuthClient,
  setCredentialsFromSession,
  refreshTokenIfNeeded,
  type GoogleTokens,
} from '../services/googleAuth.js';

// Extend Express Request type to include oauthClient
declare global {
  namespace Express {
    interface Request {
      oauthClient?: any;
      userTokens?: GoogleTokens;
    }
  }
}

/**
 * Middleware that verifies user is authenticated and attaches OAuth client to request
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const tokens = (req.session as any).tokens as GoogleTokens | undefined;

    if (!tokens) {
      res.status(401).json({
        error: 'Not authenticated. Visit /api/auth/google to sign in.',
        authUrl: '/api/auth/google',
      });
      return;
    }

    // Create OAuth client and set credentials
    const client = createOAuthClient();
    setCredentialsFromSession(client, tokens);

    // Refresh token if needed and update session
    const refreshedTokens = await refreshTokenIfNeeded(client, tokens);
    (req.session as any).tokens = refreshedTokens;
    setCredentialsFromSession(client, refreshedTokens);

    // Attach to request for use in route handlers
    req.oauthClient = client;
    req.userTokens = refreshedTokens;

    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication error';
    res.status(401).json({ error: message });
  }
}
