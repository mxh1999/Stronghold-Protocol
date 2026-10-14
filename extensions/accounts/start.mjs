import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../server/index.js';
import { ROOT, parseTrustProxy } from '../../server/http/config.js';
import { openAccounts } from './server/accounts.mjs';
import { openSaves } from './server/saves.mjs';
import { createAuth } from './server/auth.mjs';
import { createRoutes, extendShell } from './server/http.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
export const defaultDataDir = () => path.resolve(process.env.SP_ACCOUNT_DATA || path.join(root, 'var'));
export function parseOrigin(value) {
  if (!value) throw new Error('Set SP_ACCOUNT_ORIGIN to the public HTTPS origin');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Origin must have no path or credentials');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('HTTPS required except for loopback development');
  }
  return url.origin;
}
function canonical(file) {
  const absolute = path.resolve(file);
  try { return realpathSync(absolute); }
  catch (e) {
    if (e.code !== 'ENOENT' || path.dirname(absolute) === absolute) throw e;
    return path.join(canonical(path.dirname(absolute)), path.basename(absolute));
  }
}
export async function startAccountServer(options = {}) {
  const { origin: originOption, accountDataDir: dataDir = defaultDataDir(), registration = process.env.SP_ACCOUNT_REGISTRATION !== 'closed', sessionMs, ...upstream } = options;
  const origin = parseOrigin(originOption ?? process.env.SP_ACCOUNT_ORIGIN);
  // Both SQLite and readable saves must stay outside EVERY upstream static mount.
  for (const dir of ['public', 'data', 'shared', 'packs', 'server/sim'].map((d) => path.join(ROOT, d))
    .concat(['publicDir', 'dataDir', 'sharedDir', 'packsDir'].map((k) => upstream[k]).filter(Boolean))) {
    for (const file of [dataDir, path.join(dataDir, 'accounts.sqlite'), path.join(dataDir, 'saves')]) {
      const rel = path.relative(canonical(dir), canonical(file));
      if (!rel || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))) throw new Error('Account data must be outside static mounts');
    }
  }
  const publicDir = upstream.publicDir || path.join(ROOT, 'public');
  const shell = extendShell(await readFile(path.join(publicDir, 'index.html'), 'utf8'));
  await readFile(path.join(publicDir, 'js', 'preferences.js'));
  const accounts = await openAccounts(path.join(dataDir, 'accounts.sqlite'));
  const saves = openSaves(path.join(dataDir, 'saves'));
  const auth = createAuth(accounts, origin, sessionMs);
  const files = new Map(['entry.mjs', 'client.mjs', 'storage.mjs', 'sync.mjs', 'api.mjs', 'ui.mjs', 'style.css'].map((name) => [
    `/_account/${name}`, { path: path.join(root, 'public', name), type: name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' },
  ]));
  let server;
  try {
    server = await startServer({ host: process.env.HOST || '127.0.0.1', ...upstream,
      requestExtension: createRoutes({ accounts, saves, auth, files, shell, registration,
        trustProxy: upstream.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY), log: upstream.log || console }) });
  } catch (e) { accounts.close(); throw e; }
  let closing;
  return { ...server, accounts, saves, auth, origin, close() {
    return closing ||= server.close().finally(() => accounts.close());
  } };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startAccountServer();
    console.log(`[accounts] ${server.url} (public origin: ${server.origin})`);
    const stop = () => server.close().catch((e) => { console.error(e); process.exitCode = 1; });
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } catch (e) { console.error('[accounts]', e.message); process.exitCode = 1; }
}
