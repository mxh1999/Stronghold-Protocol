import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { startAccountServer, parseOrigin } from '../start.mjs';
import { openAccounts } from '../server/accounts.mjs';
import { openSaves, validData, MAX_SAVE_BYTES } from '../server/saves.mjs';
import { hashPassword, verifyPassword, createAuth } from '../server/auth.mjs';
import { extendShell } from '../server/http.mjs';
import { startServer } from '../../../server/index.js';

const ORIGIN = 'http://localhost';
const PASSWORD = 'account-test-password';
const HASH = await hashPassword(PASSWORD);
function request(url, { method = 'GET', cookie, body, origin = ORIGIN, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: {
      Origin: origin, 'X-SP-Account': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers,
    } }, (res) => {
      const chunks = []; res.on('data', (x) => chunks.push(x));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, text, json: () => JSON.parse(text), cookie: res.headers['set-cookie']?.[0].split(';')[0],
          setCookie: res.headers['set-cookie']?.[0] });
      });
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sp-accounts-'));
  const server = await startAccountServer({ accountDataDir: dir, origin: ORIGIN, port: 0, quiet: true, assetIndex: false, ...options });
  t.after(async () => { await server.close(); await rm(dir, { recursive: true, force: true }); });
  return { server, dir, api: (route, opts) => request(`${server.url}/_account/api/${route}`, opts),
    account(name) {
      const user = server.accounts.createUser(name, HASH); let cookie;
      server.auth.login({ setHeader(_key, value) { cookie = value.split(';')[0]; } }, user);
      return { user, cookie };
    },
  };
}

test('credentials are salted hashes; SQLite contains only accounts and sessions', async (t) => {
  const h = await fixture(t);
  assert.equal(await verifyPassword(PASSWORD, HASH), true);
  assert.equal(await verifyPassword('wrong-password', HASH), false);
  assert.notEqual(await hashPassword(PASSWORD), HASH);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(h.dir, 'accounts.sqlite'), { readOnly: true });
  try { assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((x) => x.name), ['sessions', 'users']); }
  finally { db.close(); }
});
test('registration/login/logout and closed registration; anonymous game remains usable', async (t) => {
  const h = await fixture(t);
  assert.equal((await request(h.server.url)).status, 200);
  assert.match((await request(h.server.url)).text, /src="\/_account\/entry.mjs"/);
  assert.equal((await h.api('session')).json().user, null);
  const register = await h.api('register', { method: 'POST', body: { username: 'Alice', password: PASSWORD } });
  assert.equal(register.status, 200); assert.ok(register.cookie);
  assert.equal((await h.api('register', { method: 'POST', body: { username: 'alice', password: PASSWORD } })).status, 409);
  assert.equal((await h.api('login', { method: 'POST', body: { username: 'Alice', password: 'wrong-password' } })).status, 401);
  const login = await h.api('login', { method: 'POST', body: { username: 'ALICE', password: PASSWORD } });
  assert.equal(login.status, 200);
  const user = login.json().user;
  assert.equal((await h.api('logout', { method: 'POST', cookie: login.cookie, body: { userId: user.id } })).status, 200);
  assert.equal((await h.api('save', { cookie: login.cookie })).status, 401);
  const ws = new WebSocket(h.server.url.replace('http:', 'ws:') + '/ws');
  t.after(() => ws.terminate()); await once(ws, 'open');
  const welcomed = once(ws, 'message'); ws.send(JSON.stringify({ t: 'hello', name: 'Guest' }));
  assert.equal(JSON.parse((await welcomed)[0]).t, 'welcome');
  const closed = await fixture(t, { registration: false });
  assert.equal((await closed.api('register', { method: 'POST', body: { username: 'Alice', password: PASSWORD } })).status, 403);
});
test('save API isolates accounts, enforces origin/revisions and writes readable native JSON', async (t) => {
  const h = await fixture(t); const a = h.account('Alice'), b = h.account('Bob');
  const data = { 'sp.pref.loadout': { v: 1, entries: {}, ops: { char_172_svrash: { potential: 2 } } },
    'sp.pref.settings': { master: .2 }, 'sp.pref.stats': { v: 1, records: [] } };
  const input = { method: 'PUT', cookie: a.cookie, body: { userId: a.user.id, revision: 0, data } };
  assert.equal((await h.api('save')).status, 401);
  assert.equal((await h.api('save', { ...input, origin: 'https://evil.example' })).status, 403);
  assert.equal((await h.api('save', { ...input, headers: { 'X-SP-Account': '' } })).status, 403);
  assert.equal((await h.api('save', { ...input, cookie: b.cookie })).status, 409);
  assert.equal((await h.api('save', input)).json().revision, 1);
  assert.equal((await h.api('save', input)).status, 409);
  assert.deepEqual((await h.api('save', { cookie: a.cookie })).json().data, data);
  assert.equal((await h.api('save', { cookie: b.cookie })).json().data, null);
  const saved = JSON.parse(await readFile(path.join(h.dir, 'saves', a.user.id + '.json'), 'utf8'));
  assert.deepEqual(saved, { v: 1, revision: 1, data });
  assert.equal((await h.api('save', { ...input, body: { ...input.body, data: { 'sp.token': 'not-a-preference' } } })).status, 400);
  assert.equal((await h.api('save', { ...input, body: { value: 'x'.repeat(MAX_SAVE_BYTES + 2048) } })).status, 413);
  for (const route of ['/extensions/accounts/var/accounts.sqlite', '/_account/server/accounts.mjs', '/_account/saves/' + a.user.id + '.json']) {
    assert.notEqual((await request(h.server.url + route, { cookie: a.cookie })).status, 200);
  }
});
test('password reset, expired cookies, and rate limits protect saves', async (t) => {
  const h = await fixture(t); const a = h.account('Alice');
  h.server.accounts.setPassword(a.user.id, HASH);
  assert.equal((await h.api('save', { cookie: a.cookie })).status, 401);
  const expired = createAuth(h.server.accounts, ORIGIN, -1); let cookie;
  expired.login({ setHeader(_k, v) { cookie = v.split(';')[0]; } }, a.user);
  assert.equal((await h.api('save', { cookie })).status, 401);
  for (let i = 0; i < 10; i++) assert.equal((await h.api('login', { method: 'POST', body: {} })).status, 400);
  assert.equal((await h.api('login', { method: 'POST', body: {} })).status, 429);
});
test('JSON survives restart, writes atomically, preserves corrupt saves, and credentials reopen', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sp-save-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbfile = path.join(dir, 'accounts.sqlite');
  let accounts = await openAccounts(dbfile);
  const user = accounts.createUser('Alice', HASH); accounts.close();
  const saves = openSaves(path.join(dir, 'saves'));
  saves.write(user.id, 0, { 'sp.pref.stats': { v: 1, records: [] } });
  saves.write(user.id, 1, { 'sp.pref.lang': 'en' });
  assert.equal(openSaves(saves.directory).read(user.id).revision, 2);
  assert.deepEqual(await readdir(saves.directory), [user.id + '.json']);
  const file = path.join(saves.directory, user.id + '.json');
  await writeFile(file, '{broken');
  assert.throws(() => saves.write(user.id, 2, {})); assert.equal(await readFile(file, 'utf8'), '{broken');
  assert.throws(() => saves.read('../../escape'), /Invalid account/);
  accounts = await openAccounts(dbfile);
  try { assert.equal(accounts.findUser('Alice').password_hash, HASH); } finally { accounts.close(); }
});
test('startup and save validation reject exposed paths, incompatible data and insecure origins', async () => {
  assert.equal(validData({}), true);
  assert.equal(validData({ 'sp.pref.stats': JSON.parse('{"__proto__":1}') }), false);
  assert.equal(validData({ secret: 'invalid' }), false);
  assert.throws(() => extendShell('<html>'), /boot entry/);
  assert.throws(() => parseOrigin('http://game.example'), /HTTPS/);
  assert.throws(() => parseOrigin('https://game.example/path'), /path/);
  await assert.rejects(startAccountServer({ origin: ORIGIN, accountDataDir: 'public/account-data' }), /static mounts/);
});
test('stock entry has no accounts UI or account API', async (t) => {
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false }); t.after(() => server.close());
  assert.match((await request(server.url)).text, /src="\/js\/main.js"/);
  assert.notEqual((await request(server.url + '/_account/api/session')).status, 200);
});

test('public HTTP requires explicit opt-in without relaxing scheme or origin validation', () => {
  for (const origin of ['http://game.example', 'http://192.0.2.10']) {
    assert.throws(() => parseOrigin(origin), /HTTPS/);
    assert.throws(() => parseOrigin(origin, { allowInsecureHttp: false }), /HTTPS/);
    assert.throws(() => parseOrigin(origin, { allowInsecureHttp: '1' }), /HTTPS/);
    assert.equal(parseOrigin(origin, { allowInsecureHttp: true }), origin);
  }
  for (const origin of ['http://localhost', 'http://127.0.0.1', 'http://[::1]', 'https://game.example']) {
    assert.equal(parseOrigin(origin), origin);
  }
  for (const origin of ['ftp://game.example', 'ws://game.example', 'http://user:pass@game.example',
    'http://game.example/path', 'http://game.example?x=1', 'http://game.example#x']) {
    assert.throws(() => parseOrigin(origin, { allowInsecureHttp: true }));
  }
});

test('opted-in public HTTP registers, logs in and saves with HTTP cookies and exact Origin checks', async (t) => {
  const origin = 'http://192.0.2.10';
  const h = await fixture(t, { origin, allowInsecureHttp: true });
  const registered = await h.api('register', { method: 'POST', origin, body: { username: 'HttpUser', password: PASSWORD } });
  assert.equal(registered.status, 200);
  assert.match(registered.setCookie, /^sp-account-dev=/);
  assert.match(registered.setCookie, /HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(registered.setCookie, /; Secure/);
  const login = await h.api('login', { method: 'POST', origin, body: { username: 'HttpUser', password: PASSWORD } });
  assert.equal(login.status, 200);
  const user = login.json().user;
  const data = { 'sp.pref.settings': { bgm: .27 }, 'sp.name': 'HTTP Player' };
  const input = { method: 'PUT', origin, cookie: login.cookie, body: { userId: user.id, revision: 0, data } };
  assert.equal((await h.api('save', { ...input, origin: 'http://other.example' })).status, 403);
  assert.equal((await h.api('save', input)).status, 200);
  assert.deepEqual((await h.api('save', { cookie: login.cookie })).json().data, data);
  assert.deepEqual(JSON.parse(await readFile(path.join(h.dir, 'saves', user.id + '.json'), 'utf8')).data, data);
  const secure = createAuth(h.server.accounts, 'https://game.example');
  let cookie;
  secure.login({ setHeader(_key, value) { cookie = value; } }, user);
  assert.match(cookie, /^__Host-sp-account=/);
  assert.match(cookie, /; Secure$/);
});

test('the deployment environment flag accepts only 1 and explicit options override it', async (t) => {
  const previous = process.env.SP_ACCOUNT_ALLOW_INSECURE_HTTP;
  t.after(() => {
    if (previous === undefined) delete process.env.SP_ACCOUNT_ALLOW_INSECURE_HTTP;
    else process.env.SP_ACCOUNT_ALLOW_INSECURE_HTTP = previous;
  });
  const origin = 'http://192.0.2.10';
  for (const flag of ['0', 'true', '']) {
    process.env.SP_ACCOUNT_ALLOW_INSECURE_HTTP = flag;
    await assert.rejects(startAccountServer({ origin }), /HTTPS/);
  }
  process.env.SP_ACCOUNT_ALLOW_INSECURE_HTTP = '1';
  await assert.rejects(startAccountServer({ origin, allowInsecureHttp: false }), /HTTPS/);
  const h = await fixture(t, { origin });
  assert.equal((await h.api('session')).status, 200);
});
