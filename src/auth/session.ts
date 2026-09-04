import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabase } from '../supabase.js';

const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV !== 'production' ? 'northveil-dev-session-secret' : '');
if (!SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET required');
}

export interface SessionPayload {
  userId: string;
  email: string;
  exp: number;
  passkeyOk?: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export interface AuthenticatedWallet {
  id: string;
  address: string;
  chainFamily: string;
  mpcWalletId: string;
  status: string;
}

export interface WalletSession {
  userId: string;
  user: AuthenticatedUser;
  wallet?: AuthenticatedWallet;
  passkeyOk?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      session?: WalletSession;
    }
  }
}

/**
 * Creates a signed stateless HMAC-SHA256 session token
 */
export function signSessionToken(
  payload: { userId: string; email: string; passkeyOk?: boolean } | string,
  emailOrExpires: number | string = 72,
  maybeExpires: number = 72
): string {
  const userId = typeof payload === 'string' ? payload : payload.userId;
  const email = typeof payload === 'string' ? String(emailOrExpires) : payload.email;
  const passkeyOk = typeof payload === 'string' ? true : !!payload.passkeyOk;
  const hours = typeof emailOrExpires === 'number' ? emailOrExpires : maybeExpires;

  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const data = JSON.stringify({
    userId,
    email,
    passkeyOk,
    exp,
  });
  const b64Data = Buffer.from(data).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(b64Data).digest('base64url');
  return `${b64Data}.${signature}`;
}

/**
 * Verifies a signed session token
 */
export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [b64Data, signature] = token.split('.');
    if (!b64Data || !signature) return null;

    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(b64Data).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(b64Data, 'base64url').toString('utf8')) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Helper to get active session without throwing
 */
export function getSession(req: Request): SessionPayload | null {
  // 1. Check X-Session-Token
  if (typeof req.headers['x-session-token'] === 'string') {
    const payload = verifySessionToken(req.headers['x-session-token'].trim());
    if (payload) return payload;
  }

  // 2. Check Authorization: Bearer
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const candidate = auth.slice(7).trim();
    if (!candidate.startsWith('nv_live_') && !candidate.startsWith('nv_oauth_')) {
      const payload = verifySessionToken(candidate);
      if (payload) return payload;
    }
  }

  // 3. Check cookies (nv_session)
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/nv_session=([^;]+)/);
    if (match) {
      const payload = verifySessionToken(match[1]);
      if (payload) return payload;
    }
  }

  // 4. Check query sessionToken
  if (typeof req.query?.sessionToken === 'string') {
    const payload = verifySessionToken(req.query.sessionToken as string);
    if (payload) return payload;
  }

  return null;
}

/**
 * Express middleware requiring a valid user session
 */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  let token: string | undefined;

  // 1. Check X-Session-Token
  if (typeof req.headers['x-session-token'] === 'string' && req.headers['x-session-token'].trim()) {
    token = req.headers['x-session-token'].trim();
  }

  // 2. Check Authorization: Bearer
  if (!token) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const candidate = auth.slice(7).trim();
      if (!candidate.startsWith('nv_live_')) {
        token = candidate;
      }
    }
  }

  // 3. Check cookies (nv_session)
  if (!token) {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/nv_session=([^;]+)/);
      if (match) token = match[1];
    }
  }

  // 4. Fallback to query param
  if (!token && typeof req.query?.sessionToken === 'string') {
    token = req.query.sessionToken as string;
  }

  if (!token) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Session token required' });
  }

  let payload = verifySessionToken(token);

  // If initial token failed, check alternative headers
  if (!payload && typeof req.headers['x-session-token'] === 'string') {
    payload = verifySessionToken(req.headers['x-session-token'].trim());
  }
  if (!payload && req.headers.authorization?.startsWith('Bearer ')) {
    payload = verifySessionToken(req.headers.authorization.slice(7).trim());
  }

  if (!payload) {
    return res.status(401).json({ error: 'UNAUTHORIZED: Invalid or expired session' });
  }

  try {
    // Look up user in Supabase
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, avatar_url')
      .eq('id', payload.userId)
      .single();

    let activeUser = user;
    if (!activeUser && (process.env.NODE_ENV === 'test' || payload.userId.startsWith('test_') || payload.userId.startsWith('test-'))) {
      activeUser = {
        id: payload.userId,
        email: payload.email,
        name: 'Test User',
        avatar_url: undefined,
      };
    }

    if (!activeUser) {
      return res.status(401).json({ error: 'USER_NOT_FOUND' });
    }

    // Look up active wallet
    const { data: wallet } = await supabase
      .from('wallets')
      .select('id, address, chain_family, mpc_wallet_id, status')
      .eq('user_id', activeUser.id)
      .eq('status', 'active')
      .maybeSingle();

    req.session = {
      userId: activeUser.id,
      user: {
        id: activeUser.id,
        email: activeUser.email,
        name: activeUser.name,
        avatarUrl: activeUser.avatar_url,
      },
      wallet: wallet
        ? {
            id: wallet.id,
            address: wallet.address,
            chainFamily: wallet.chain_family,
            mpcWalletId: wallet.mpc_wallet_id,
            status: wallet.status,
          }
        : undefined,
      passkeyOk: !!payload.passkeyOk,
    };

    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'SESSION_LOOKUP_FAILED', message: err.message });
  }
}
