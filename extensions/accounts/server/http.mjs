import { readFile } from 'node:fs/promises';
import { validUsername, validPassword, hashPassword, verifyPassword } from './auth.mjs';
import { validData, MAX_SAVE_BYTES } from './saves.mjs';
import { clientAddress } from '../../../server/net.js';

const fail = (status, code) => Object.assign(new Error(code), { status });
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
async function body(req, limit = 4096) {
  if (String(req.headers['content-type']).split(';')[0].trim() !== 'application/json') throw fail(415, 'JSON_REQUIRED');
  if (Number(req.headers['content-length']) > limit) throw fail(413, 'TOO_LARGE');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length; if (size > limit) throw fail(413, 'TOO_LARGE'); chunks.push(chunk);
  }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(400, 'BAD_INPUT'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'BAD_INPUT');
  return input;
}
export function extendShell(html) {
  if (html.split('src="/js/main.js"').length !== 2) throw new Error('Upstream boot entry changed');
  // Load preferences before ANY application module creates stores from them.
  return html.replace('src="/js/main.js"', 'src="/_account/entry.mjs"');
}
export function createRoutes({ accounts, saves, auth, files, shell, registration, trustProxy, log = console }) {
  return async (req, res, parts) => {
    let path;
    try { path = decodeURIComponent(parts.rawPath).replace(/\/+/g, '/'); } catch { return false; }
    if ((path === '/' || path.toLowerCase() === '/index.html') && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : shell); return true;
    }
    const file = files.get(path);
    if (file && ['GET', 'HEAD'].includes(req.method)) {
      const bytes = await readFile(file.path);
      res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : bytes); return true;
    }
    if (!path.startsWith('/_account/')) return false;
    try {
      if (['POST', 'PUT'].includes(req.method) && (!auth.sameOrigin(req) || req.headers['x-sp-account'] !== '1')) throw fail(403, 'ORIGIN');
      const route = `${req.method} ${path}`;
      const user = auth.resolve(req);
      if (route === 'GET /_account/api/session') { json(res, 200, { user, registration }); return true; }
      if (route === 'POST /_account/api/login' || route === 'POST /_account/api/register') {
        if (!auth.allow(clientAddress(req, trustProxy).ip)) throw fail(429, 'RATE');
        const input = await body(req);
        if (!validUsername(input.username) || !validPassword(input.password)) throw fail(400, 'CREDENTIAL_FORMAT');
        const registering = path.endsWith('/register');
        if (registering && !registration) throw fail(403, 'REGISTRATION_CLOSED');
        const logged = await auth.passwordWork(async () => {
          const existing = accounts.findUser(input.username);
          if (registering) {
            if (existing) throw fail(409, 'USERNAME_TAKEN');
            return accounts.createUser(input.username, await hashPassword(input.password));
          }
          const hash = existing?.password_hash || `scrypt1:${'0'.repeat(32)}:${'0'.repeat(128)}`;
          if (!await verifyPassword(input.password, hash) || !existing) throw fail(401, 'INVALID_CREDENTIALS');
          return { id: existing.id, username: existing.username };
        });
        auth.logout(req, res); auth.login(res, logged); json(res, 200, { user: logged }); return true;
      }
      if (!user) throw fail(401, 'LOGIN_REQUIRED');
      if (route === 'GET /_account/api/save') { json(res, 200, { userId: user.id, ...saves.read(user.id) }); return true; }
      if (route === 'PUT /_account/api/save') {
        const input = await body(req, MAX_SAVE_BYTES + 1024);
        // Re-resolve after receiving the body: logout or password reset can happen during an upload.
        if (auth.resolve(req)?.id !== user.id) throw fail(401, 'LOGIN_REQUIRED');
        if (input.userId !== user.id) throw fail(409, 'ACCOUNT_CHANGED');
        if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !validData(input.data)) throw fail(400, 'BAD_SAVE');
        const saved = saves.write(user.id, input.revision, input.data);
        if (!saved) throw fail(409, 'SAVE_CONFLICT');
        json(res, 200, { revision: saved.revision }); return true;
      }
      if (route === 'POST /_account/api/logout') {
        const input = await body(req);
        if (input.userId !== user.id) throw fail(409, 'ACCOUNT_CHANGED');
        auth.logout(req, res); json(res, 200, { ok: true }); return true;
      }
      throw fail(404, 'NOT_FOUND');
    } catch (e) {
      if (!e.status) log.error('[accounts] request failed', e);
      if (!res.headersSent && !res.destroyed) json(res, e.status || 500, { error: e.status ? e.message : 'INTERNAL' });
    }
    return true;
  };
}
