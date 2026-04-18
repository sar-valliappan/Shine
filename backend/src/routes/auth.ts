import { Router, Request, Response } from 'express';
import { createOAuthClient, SCOPES, type GoogleTokens } from '../services/googleAuth.js';

const router = Router();

/**
 * GET /api/auth/google
 * Initiates Google OAuth flow by redirecting to Google consent screen
 */
router.get('/google', (req: Request, res: Response) => {
  try {
    const client = createOAuthClient();
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    res.redirect(authUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth initialization failed';
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/auth/callback
 * Handles the OAuth callback from Google with authorization code
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, error, error_description } = req.query;

    if (error) {
      return res.status(400).json({
        error: error_description || 'Google OAuth denied or cancelled.',
      });
    }

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'No authorization code received from Google' });
    }

    // Exchange authorization code for tokens
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);

    const googleTokens: GoogleTokens = {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token || undefined,
      expiry_date: tokens.expiry_date || undefined,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope,
    };

    // Store tokens in session
    (req.session as any).tokens = googleTokens;

    // Redirect back to frontend app
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token exchange failed';
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /api/auth/status
 * Returns 200 if user is authenticated, 401 if not
 */
router.get('/status', (req: Request, res: Response) => {
  const tokens = (req.session as any).tokens;
  if (tokens) {
    res.json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

/**
 * GET /api/auth/logout
 * Clears session tokens and signs user out
 */
router.get('/logout', (req: Request, res: Response) => {
  (req.session as any).tokens = undefined;
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to clear session' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

export default router;
