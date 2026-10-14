// The production server offers both collaboration picks, including their skills, modules and fixed bond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, startRealServer } from '../e2e/client.mjs';

test('Sakiko and Makoto are selectable and persist with their support bond', {
  skip: !(process.env.SP_E2E === '1' && hasChrome()) && 'set SP_E2E=1 with Chrome', timeout: 90000,
}, async () => {
  const srv = await startRealServer();
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'collab-picks', { prefix: 'collab-picks', w: 1440, h: 900 });
  try {
    await c.open();
    await c.enter('Collaboration picks');
    await c.click('.lobby-screen [data-testid="loadout-open"]');
    await c.click('.lo .lo-tab[data-tab="diy"]');
    for (const [tier, charId, key] of [[5, 'char_4182_oblvns', 'oblvns'], [6, 'char_4217_makoto', 'makoto']]) {
      const slot = `chess_char_${tier}_diy1_a`, picker = '[data-testid="diy-picker"]';
      await c.click(`.diy-slot[data-slot="${slot}"] .diy-slot__fill`);
      const option = `${picker} .diy-opt[data-char="${charId}"]`;
      await c.page.waitForSelector(option, { timeout: 8000 });
      await c.page.$eval(option, (e) => e.scrollIntoView({ block: 'nearest' }));
      await c.page.click(option);
      assert.equal(await c.page.$$eval(`${picker} [data-skill]`, (es) => es.length), 3);
      await c.page.click(`${picker} [data-skill="2"]`);
      await c.page.click(`${picker} [data-module="uniequip_002_${key}"]`);
      await c.click('[data-testid="diy-confirm"]');
      await c.page.waitForSelector(picker, { hidden: true, timeout: 3000 });
      const card = `.diy-slot[data-slot="${slot}"][data-char="${charId}"]`;
      assert.match(await c.page.$eval(card, (e) => e.textContent), /协防干员/);
      assert.deepEqual(await c.page.evaluate((id) => JSON.parse(localStorage.getItem('sp.pref.diy')).picks[id], slot),
        { charId, skillIndex: 2, uniEquipId: `uniequip_002_${key}` });
    }
    await c.page.waitForFunction(() => document.querySelector('.lo')?.textContent.includes('已同步'), { timeout: 8000 });
    await c.page.reload({ waitUntil: 'domcontentloaded' });
    await c.page.waitForSelector('.lobby-screen', { timeout: 20000 });
    await c.click('.lobby-screen [data-testid="loadout-open"]');
    await c.click('.lo .lo-tab[data-tab="diy"]');
    for (const id of ['char_4182_oblvns', 'char_4217_makoto']) {
      await c.page.waitForSelector(`.diy-slot[data-char="${id}"]`, { timeout: 8000 });
    }
    await c.shot('selected');
    assert.deepEqual(c.problems.filter((p) => p.startsWith('pageerror:')), []);
  } finally { await c.close(); await srv.stop(); }
});
