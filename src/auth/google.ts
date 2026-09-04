import { supabase } from '../supabase.js';
import { upsertIdentity } from './emailOtp.js';

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export interface UserRecord {
  id: string;
  email: string;
  emailVerified: boolean;
  googleSub: string;
  name?: string;
  avatarUrl?: string;
  createdAt: Date;
  lastLoginAt: Date;
}

/**
 * Exchanges Google OAuth 2.0 authorization code for user profile information
 */
export async function exchangeGoogleCode(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<GoogleUserInfo> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials not configured in environment');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${errorBody}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string; id_token: string };

  // Fetch verified user profile
  const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error('Failed to retrieve userinfo from Google');
  }

  const userInfo = (await userRes.json()) as GoogleUserInfo;

  if (!userInfo.email_verified) {
    throw new Error('UNVERIFIED_EMAIL: Google account email must be verified');
  }

  return userInfo;
}

/**
 * Upserts a verified Google user into public.users using canonical upsertIdentity
 */
export async function upsertGoogleUser(info: GoogleUserInfo): Promise<UserRecord> {
  const user = await upsertIdentity({
    email: info.email,
    googleSub: info.sub,
    name: info.name,
    avatarUrl: info.picture,
  });

  return {
    id: user.id,
    email: user.email,
    emailVerified: user.email_verified ?? true,
    googleSub: user.google_sub,
    name: user.name,
    avatarUrl: user.avatar_url,
    createdAt: new Date(user.created_at || Date.now()),
    lastLoginAt: new Date(user.last_login_at || Date.now()),
  };
}
