import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { startAccountServer } from '../start.mjs';

async function availablePort() {
  for (let port = 32200; port < 32300; port++) {
    const probe = net.createServer();
    try {
      await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
      await new Promise((resolve) => probe.close(resolve)); return port;
    } catch { /* another local process owns this port */ }
  }
  throw new Error('No free test port');
}
test('main-page login, all settings and native history sync, isolated guest storage and transfer controls', {
  skip: process.env.SP_ACCOUNT_E2E !== '1', timeout: 90000,
}, async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sp-account-browser-'));
  const port = await availablePort();
  const server = await startAccountServer({ origin: `http://127.0.0.1:${port}`, accountDataDir: dir, port,
    host: '127.0.0.1', quiet: true, assetIndex: false });
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(async () => { await browser.close(); await server.close(); await rm(dir, { recursive: true, force: true }); });
  const errors = [];
  const context = await browser.createBrowserContext(); const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message)); await page.setViewport({ width: 1280, height: 900 });
  const boot = async (page) => { await page.goto(server.url); await page.waitForFunction(() => !!globalThis.__SP__); };
  const screenshot = async (name) => {
    if (process.env.SP_ACCOUNT_SCREENSHOTS) {
      await mkdir(process.env.SP_ACCOUNT_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SP_ACCOUNT_SCREENSHOTS, name + '.png'), fullPage: true });
    }
  };
  async function signIn(page, name, register) {
    await page.click('[data-testid="account-login"]');
    await page.type('input[name="username"]', name); await page.type('input[name="password"]', 'browser-password-123');
    await Promise.all([page.waitForNavigation(), page.click(register ? 'button[value="register"]' : '.account-dialog form button[type="submit"]')]);
    await page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('[data-testid="account-logout"]'));
  }
  await boot(page); await page.waitForSelector('[data-testid="account-login"]'); await screenshot('guest-title');
  await page.evaluate(async () => {
    (await import('/js/store.js')).savePref('settings', { bgm: .23 });
    (await import('/js/store.js')).savePref('guest.marker', 'untouched');
    (await import('/js/screens/stats.js')).openStats();
  });
  await page.waitForSelector('[data-testid="stats-import"]');
  await page.evaluate(async () => (await import('/js/screens/stats.js')).closeStats());
  await page.click('[data-testid="account-login"]'); await screenshot('login');
  await page.click('.account-close');
  await signIn(page, 'BrowserUser', true);
  const user = server.accounts.findUser('BrowserUser');
  assert.equal(server.saves.read(user.id).data['sp.pref.guest.marker'], 'untouched');
  await page.evaluate(async () => {
    const { savePref } = await import('/js/store.js');
    (await import('/js/ui/settings.js')).settingsStore.set({ bgm: .41, quality: 'low' }); savePref('lobby.difficulty', 'HARD'); savePref('emoteTheme', 'custom');
    (await import('/js/ui/loadoutSync.js')).setOpsMap({ char_172_svrash: { potential: 2 } });
    (await import('/js/net.js')).identity.saveName('CloudDoctor');
  });
  await page.waitForFunction(async () => (await (await fetch('/_account/api/save')).json()).data['sp.pref.settings'].bgm === .41);
  await page.evaluate(async () => (await import('/js/screens/stats.js')).openStats());
  await page.waitForSelector('.st');
  assert.equal(await page.$('[data-testid="stats-export"]'), null); assert.equal(await page.$('[data-testid="stats-import"]'), null);
  assert.match(await page.$eval('.st-note', (node) => node.textContent), /服务器/);
  await page.evaluate(async () => (await import('/js/screens/stats.js')).closeStats());
  await page.evaluate(async () => (await import('/js/screens/loadout.js')).openLoadout());
  await page.waitForSelector('.lo');
  for (const tab of ['loadout', 'ownership', 'diy']) {
    await page.evaluate(async (tab) => (await import('/js/ui/loadoutSync.js')).loadoutStore.set({ tab }), tab);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(await page.$(`[data-testid="${tab}-export"]`), null);
    assert.equal(await page.$(`[data-testid="${tab}-import"]`), null);
  }
  await page.evaluate(async () => (await import('/js/ui/loadoutSync.js')).loadoutStore.set({ open: false }));
  await screenshot('signed-in-title');
  const second = await browser.createBrowserContext(); const other = await second.newPage();
  other.on('pageerror', (e) => errors.push(e.message)); await boot(other); await signIn(other, 'BrowserUser', false);
  assert.deepEqual(await other.evaluate(async () => {
    const { loadPref } = await import('/js/store.js');
    const settings = (await import('/js/ui/settings.js')).settingsStore.get();
    return [settings.bgm, settings.quality, loadPref('lobby.difficulty', null),
      (await import('/js/ui/loadoutSync.js')).loadoutStore.get().ops.char_172_svrash.potential,
      (await import('/js/net.js')).identity.loadName()];
  }), [.41, 'low', 'HARD', 2, 'CloudDoctor']);
  // A real upstream result is recorded by its existing browser recorder, then saved by the same preference backend.
  await page.evaluate(async () => {
    const net = globalThis.__SP__.net;
    await new Promise((resolve) => { const off = net.on('welcome', () => { off(); resolve(); }); net.setName('CloudDoctor'); });
    await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' }); await net.request('room.start', {});
  });
  [...server.lobby.rooms.values()][0].match.finish({ victory: false, reason: 'test' });
  await page.waitForFunction(async () => (await (await fetch('/_account/api/save')).json()).data['sp.pref.stats']?.records.length === 1);
  await other.reload(); await other.waitForFunction(() => !!globalThis.__SP__);
  assert.equal(await other.evaluate(async () => (await import('/js/ui/stats.js')).loadStats().records.length), 1);
  // A stale device cannot overwrite a newer save; drafts remain available until an explicit reload.
  await page.evaluate(async () => (await import('/js/store.js')).savePref('test.conflict', 'first'));
  await page.waitForFunction(async () => (await (await fetch('/_account/api/save')).json()).data['sp.pref.test.conflict'] === 'first');
  await other.evaluate(async () => (await import('/js/store.js')).savePref('test.conflict', 'second'));
  await other.waitForFunction(() => document.querySelector('.account-controls [role="status"]').textContent.includes('其他页面'));
  assert.equal(server.saves.read(user.id).data['sp.pref.test.conflict'], 'first');
  // Logout returns to the exact guest preferences and shows the original transfer controls again.
  await Promise.all([page.waitForNavigation(), page.click('[data-testid="account-logout"]')]);
  await page.waitForFunction(() => !!globalThis.__SP__); await page.waitForSelector('[data-testid="account-login"]');
  assert.equal(await page.evaluate(async () => (await import('/js/store.js')).loadPref('settings', {}).bgm), .23);
  await page.evaluate(async () => (await import('/js/screens/stats.js')).openStats());
  await page.waitForSelector('[data-testid="stats-import"]');
  assert.equal(await page.evaluate(async () => (await import('/js/ui/stats.js')).loadStats().records.length), 0);
  await page.evaluate(async () => (await import('/js/screens/stats.js')).closeStats());
  await signIn(page, 'AnotherUser', true);
  assert.equal(await page.evaluate(async () => (await import('/js/ui/stats.js')).loadStats().records.length), 0);
  assert.deepEqual(errors, []);
});
