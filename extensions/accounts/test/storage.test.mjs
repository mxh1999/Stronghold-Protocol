import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, readLocal } from '../public/storage.mjs';
import { createSync } from '../public/sync.mjs';
import { setPreferenceStorage } from '../../../public/js/preferences.js';
import { loadPref, savePref } from '../../../public/js/store.js';
import { loadStats, saveStats } from '../../../public/js/ui/stats.js';
import { exportPayload, parseStored, parseStoredOps } from '../../../public/js/ui/loadoutModel.js';
import { createIdentity } from '../../../public/js/net.js';

const timers = { setTimeout: () => 1, clearTimeout() {} };
test('preference backend captures arbitrary settings and native statistics without leaking to guest storage', () => {
  const previous = globalThis.localStorage; let writes = 0;
  const local = new Map([['sp.pref.lang', '"zh"'], ['sp.name', 'Guest']]);
  globalThis.localStorage = { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, v), length: local.size, key: (i) => [...local.keys()][i] };
  const backend = createStorage({ 'sp.pref.lang': 'en', 'sp.name': 'Alice' }, () => writes++);
  try {
    setPreferenceStorage(backend);
    assert.equal(loadPref('lang', 'zh'), 'en');
    savePref('settings', { master: .2 }); savePref('future.option', { value: true });
    assert.equal(saveStats({ v: 1, records: [] }), true); assert.deepEqual(loadStats().records, []);
    const identity = createIdentity({ channel: null }); identity.saveName('Doctor'); assert.equal(identity.loadName(), 'Doctor');
    assert.equal(writes, 4); assert.equal(local.get('sp.name'), 'Guest'); assert.equal(local.has('sp.pref.stats'), false);
    const portable = exportPayload({ c: { skill: 1 } }, { ops: { char_172_svrash: { potential: 2 } } });
    savePref('loadout', portable);
    const recovered = createStorage(JSON.parse(JSON.stringify(backend.snapshot())));
    assert.deepEqual(parseStored(JSON.parse(recovered.getItem('sp.pref.loadout'))), portable.entries);
    assert.deepEqual(parseStoredOps(JSON.parse(recovered.getItem('sp.pref.loadout'))), portable.ops);
    setPreferenceStorage(null); assert.equal(loadPref('lang', 'en'), 'zh');
    assert.deepEqual(readLocal(globalThis.localStorage), { 'sp.pref.lang': 'zh', 'sp.name': 'Guest' });
  } finally { setPreferenceStorage(null); globalThis.localStorage = previous; }
});
test('hydration does not save; concurrent edits wait for the committed revision', async () => {
  let value = { n: 1 }, release; const calls = [];
  const sync = createSync({ initial: { revision: 2, data: value }, read: () => structuredClone(value), timers,
    save: async (body) => { calls.push(body); if (calls.length === 1) await new Promise((r) => { release = r; }); return { revision: body.revision + 1 }; },
  });
  await sync.flush(); assert.equal(calls.length, 0);
  value = { n: 2 }; const saving = sync.flush(); value = { n: 3 }; sync.changed(); release(); await saving;
  assert.deepEqual(calls.map((x) => x.revision), [2, 3]); assert.equal(sync.dirty(), false);
});
test('network failures retry; conflicts keep pending data and never overwrite another device', async () => {
  let value = {}, failure = new Error('offline'), calls = 0; const states = [];
  const sync = createSync({ initial: { revision: 1, data: value }, read: () => structuredClone(value), timers,
    status: (s) => states.push(s), save: async () => { calls++; if (failure) throw failure; return { revision: 2 }; },
  });
  value = { n: 2 }; assert.equal(await sync.flush(), false); assert.equal(states.at(-1), 'retry');
  failure = null; assert.equal(await sync.flush(), true);
  value = { n: 3 }; failure = Object.assign(new Error('conflict'), { status: 409 });
  await sync.flush(); await sync.flush(); assert.equal(calls, 3); assert.equal(sync.dirty(), true); assert.equal(states.at(-1), 'conflict');
});
