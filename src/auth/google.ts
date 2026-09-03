import { supabase } from '../supabase.js';

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
 * Upserts a verified Google user into public.users using google_sub
 */
export async function upsertGoogleUser(info: GoogleUserInfo): Promise<UserRecord> {
  const email = info.email.toLowerCase().trim();
  const now = new Date();

  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        google_sub: info.sub,
        email,
        email_verified: info.email_verified,
        name: info.name || null,
        avatar_url: info.picture || null,
        last_login_at: now.toISOString(),
      },
      { onConflict: 'google_sub' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(`Failed to upsert user record: ${error?.message}`);
  }

  return {
    id: data.id,
    email: data.email,
    emailVerified: data.email_verified,
    googleSub: data.google_sub,
    name: data.name,
    avatarUrl: data.avatar_url,
    createdAt: new Date(data.created_at),
    lastLoginAt: new Date(data.last_login_at),
  };
}
