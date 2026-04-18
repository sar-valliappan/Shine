import { google } from 'googleapis';

// OAuth2 client configuration
export function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      'Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI in .env'
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// Scopes required for all Workspace APIs
export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/forms',
];

// Token structure stored in session
export interface GoogleTokens {
  access_token: string;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type: string;
  scope?: string;
}

/**
 * Set OAuth client credentials from session tokens
 */
export function setCredentialsFromSession(client: any, tokens: GoogleTokens): void {
  client.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    token_type: tokens.token_type,
  });
}

/**
 * Refresh token if it's about to expire (within 5 minutes)
 */
export async function refreshTokenIfNeeded(client: any, tokens: GoogleTokens): Promise<GoogleTokens> {
  const now = Date.now();
  const expiryDate = tokens.expiry_date || 0;
  const fiveMinutesMs = 5 * 60 * 1000;

  // If token expires within 5 minutes, refresh it
  if (expiryDate - now < fiveMinutesMs) {
    try {
      const { credentials } = await client.refreshAccessToken();
      return {
        access_token: credentials.access_token!,
        refresh_token: credentials.refresh_token || tokens.refresh_token,
        expiry_date: credentials.expiry_date || undefined,
        token_type: credentials.token_type || 'Bearer',
        scope: credentials.scope,
      };
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('Failed to refresh Google access token. Please sign in again.');
    }
  }

  return tokens;
}
