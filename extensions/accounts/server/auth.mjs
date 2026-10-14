import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const cost = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const digest = (s) => createHash('sha256').update(s).digest('hex');
export const validUsername = (v) => typeof v === 'string' && /^[A-Za-z0-9_]{3,24}$/.test(v);
export const validPassword = (v) => typeof v === 'string' && v.length >= 10 && v.length <= 128;
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt1:${salt}:${(await derive(password, salt, 64, cost)).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [version, salt, hash] = String(encoded || '').split(':');
  if (version !== 'scrypt1' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  return timingSafeEqual(await derive(password, salt, 64, cost), Buffer.from(hash, 'hex'));
}
export function createAuth(accounts, origin, sessionMs = 7 * 86400000) {
  const secure = new URL(origin).protocol === 'https:';
  const name = secure ? '__Host-sp-account' : 'sp-account-dev';
  const cookie = (token, age) => `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const tokenHash = (req) => {
    const tokens = String(req.headers.cookie || '').split(';').map((s) => s.trim()).filter((s) => s.startsWith(`${name}=`));
    const token = tokens.length === 1 ? tokens[0].slice(name.length + 1) : '';
    return /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
  };
  const attempts = new Map();
  let busy = false;
  return {
    resolve(req) { const hash = tokenHash(req); return hash ? accounts.session(hash) : null; },
    sameOrigin: (req) => req.headers.origin === origin,
    login(res, user) {
      const token = randomBytes(32).toString('hex');
      accounts.addSession(digest(token), user.id, Date.now() + sessionMs);
      res.setHeader('Set-Cookie', cookie(token, Math.floor(sessionMs / 1000)));
    },
    logout(req, res) { const hash = tokenHash(req); if (hash) accounts.revoke(hash); res.setHeader('Set-Cookie', cookie('', 0)); },
    allow(ip) {
      const now = Date.now();
      for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
      if (attempts.size >= 2048 && !attempts.has(ip)) return false;
      const v = attempts.get(ip) || { count: 0, until: now + 60000 };
      attempts.set(ip, v); return ++v.count <= 10;
    },
    async passwordWork(fn) {
      if (busy) throw Object.assign(new Error('RATE'), { status: 429 });
      busy = true;
      try { return await fn(); } finally { busy = false; }
    },
  };
}
