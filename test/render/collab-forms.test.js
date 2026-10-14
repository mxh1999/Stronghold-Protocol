// Real sim form events and reconnect metadata must select the corresponding Spine clips.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { fxForm } from '../../shared/protocol.js';

const manifest = JSON.parse(readFileSync(new URL('../../data/assets.json', import.meta.url)));
let fake, UnitView, renderInfo;
before(async () => {
  fake = installFakePixi();
  ({ UnitView } = await import('../../public/js/render/units.js'));
  ({ renderInfo } = await import('../../public/js/render/app.js'));
});
after(() => fake.restore());
const cam = () => presetCamera('normal', { width: 1280, height: 720 });
const tick = () => new Promise((r) => setImmediate(r));
async function view(info) {
  const entry = manifest.chars[info.spine].spine.front;
  const assets = { picture: () => null, image: async () => null, spineEntry: () => entry,
    spine: { acquire: async () => ({ animations: Object.keys(entry.animations).map((name) => ({ name })) }), release() {} } };
  const v = new UnitView(fakeViewCtx(fake.P, { assets, cam }), info);
  await tick(); await tick();
  return v;
}
function settle(v) {
  v.sync({ x: 5, y: 10, hp: 1000, maxHp: 1000, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0 }, 1);
  for (let i = 0; i < 180; i++) v.update(1 / 60, cam(), i / 60);
}
const selected = (id, skill) => makeBattle({ autoFinish: false, timeLimit: 100,
  units: [{ uid: 1, diy: { slot: 6, charId: id, skillIndex: skill }, elite: true, row: 10, col: 5 }] });
const cast = (u) => { u.skill.gainSp(999); assert.ok(u.skill.activate()); };

for (const [skill, form, idle] of [[0, 'orpheus', 'Doll_Skill_1_Idle'], [1, 'thanatos', 'Doll_Skill_2_Loop'], [2, 'thanatos3', 'Doll_Skill_3_P1_Idle']]) {
  test(`Makoto S${skill + 1}: real events and reconnects show ${form}, then All-Out and the body`, async () => {
    const h = selected('char_4217_makoto', skill);
    h.step();
    const u = h.unit(1);
    const v = await view(renderInfo(h.b.fieldMeta().units.find((a) => a.id === u.id)));
    h.b.drainEvents();
    cast(u);
    for (const e of h.b.drainEvents()) if (e[0] === 'fx' && e[4]?.id === u.id) {
      const f = fxForm(e);
      if (f !== undefined) v.setForm(f, e[4]);
    }
    assert.equal(v.form, form, 'the generic doll event cannot overwrite the selected Persona');
    settle(v);
    assert.equal(v.actor.current, idle);
    const rejoined = await view(renderInfo(h.b.fieldMeta().units.find((a) => a.id === u.id)));
    settle(rejoined);
    assert.equal(rejoined.actor.current, idle);
    rejoined.destroy();
    if (skill === 2) {
      h.run(1.1);
      h.b.loseHp(u, u.hp + 1);
      assert.equal(u.form, 'orpheus3');
      v.setForm(u.form);
      settle(v);
      assert.equal(v.actor.current, 'Doll_Skill_3_P2_Loop');
    }
    h.b.removeBuff(u, 'trait:substitute');
    assert.equal(u.form, 'allOut');
    v.setForm(u.form);
    assert.equal(v.actor.current, 'Skill_AllOutAttack_Loop');
    h.run(1.7);
    assert.equal(u.form, null);
    v.setForm(null);
    settle(v);
    assert.equal(v.actor.current, 'Idle');
    assert.deepEqual(h.b.errors, []);
    v.destroy();
  });
}

test('Sakiko S2 renders each tone and keeps it in reconnect metadata', async () => {
  const h = selected('char_4182_oblvns', 1);
  h.step();
  const u = h.unit(1);
  for (const [form, suffix] of [['piano', 'A'], ['organ', 'B'], ['piano', 'A']]) {
    assert.equal(u.form, form);
    const v = await view(renderInfo(h.b.fieldMeta().units.find((a) => a.id === u.id)));
    settle(v);
    assert.equal(v.actor.current, `Skill_2_Idle_${suffix}`);
    v.onAttack(null, 4);
    assert.equal(v.actor.current, `Skill_2_Loop_${suffix}`);
    v.destroy();
    cast(u);
  }
});
