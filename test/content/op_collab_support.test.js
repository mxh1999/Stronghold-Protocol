// Production DIY loadouts and semantic regressions for Sakiko Togawa and Makoto Yuki.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';

const SAKIKO = 'char_4182_oblvns', MAKOTO = 'char_4217_makoto';
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const patient = chessRec({ id: 'patient', hp: 10000, atk: 0 });
function field(charId, skill = 0, { tier = 6, elite = true, module = false, others = [], ...opts } = {}) {
  const h = makeBattle({ seed: 19, timeLimit: 300, autoFinish: false, captureNoisy: true,
    hooks: ['attack', 'hit', 'damaged', 'heal', 'skillStart', 'skillEnd', 'death'],
    defs: { chess: { patient }, enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, atk: 0, speed: 0 }),
      flyer: enemyRec({ key: 'flyer', hp: 1e8, atk: 0, speed: 0, motion: 'FLY' }) } },
    units: [{ uid: 1, diy: { slot: `chess_char_${tier}_diy1_a`, charId, skillIndex: skill,
      uniEquipId: module ? `uniequip_002_${charId === SAKIKO ? 'oblvns' : 'makoto'}` : 'none' }, elite, row: 10, col: 5 }, ...others], ...opts });
  h.step();
  return { h, u: h.unit(1) };
}
const cast = (u) => { u.skill.gainSp(999); assert.ok(u.skill.activate()); };
const hits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u);
function done(h) { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); }

test('both operators use authored skills, support bonds and all normal/elite module forms', () => {
  for (const id of [SAKIKO, MAKOTO]) for (const tier of [5, 6]) for (const elite of [false, true]) for (const module of [false, true]) for (let skill = 0; skill < 3; skill++) {
    const { h, u } = field(id, skill, { tier, elite, module });
    assert.ok(KITTED_CHARS.includes(id));
    assert.equal(u.kit.skillSource, 'skills');
    assert.equal(u.def.charId, id);
    assert.deepEqual(u.def.bonds, ['emptyShip']);
    assert.deepEqual(u.def.raw.garrisonIds, []);
    assert.equal(u.skill.id, `skchr_${id === SAKIKO ? 'oblvns' : 'makoto'}_${skill + 1}`);
    h.spawn('dummy', { pos: [10, 6] });
    h.run(35);
    assert.ok(u.skill.activations > 0);
    assert.ok(hits(h, u).length > 0);
    done(h);
  }
});

test('Sakiko attacks empty space, recovers attack SP, auto-releases eight notes at full charges and cleans expired notes', () => {
  const { h, u } = field(SAKIKO);
  h.run(12);
  assert.ok(u.stats.attacks >= 9);
  assert.ok(u.skill.activations >= 1);
  assert.ok(h.hooksOf('skillStart').every((c) => c.reason === 'fullNotes'));
  assert.equal(u.mem.oblvnsFever.value, 0);
  assert.ok(u.mem.oblvnsNotes.size > 0);
  u.profile.noAttack = true;
  u.skill.setTrigger('NEVER');
  h.run(15);
  assert.equal(u.mem.oblvnsNotes.size, 0);
  assert.equal(h.b.projectiles.list.length, 0);
  done(h);
});

test('Sakiko respects disarm and the impassable front tile for targetless attacks', () => {
  const { h, u } = field(SAKIKO, 0, { units: [{ uid: 1, diy: { slot: 6, charId: SAKIKO, skillIndex: 0 }, row: 12, col: 5, dir: 'UP' }] });
  h.run(4);
  assert.equal(u.stats.attacks, 0);
  h.spawn('dummy', { pos: [12, 6] });
  h.run(2);
  assert.ok(u.stats.attacks > 0, 'a valid target permits notes even across an impassable front tile');
  h.b.addBuff(u, { key: 'testDisarm', flags: { disarm: true } });
  const count = u.stats.attacks;
  h.run(3);
  assert.equal(u.stats.attacks, count);
  done(h);
});

test('Sakiko S1 snapshots ATK and each of its eight scales; module removes the ranged penalty only when eligible', () => {
  for (const module of [false, true]) {
    const { h, u } = field(SAKIKO, 0, { module });
    u.profile.noAttack = true;
    h.run(8);
    cast(u);
    const notes = [...u.mem.oblvnsNotes];
    assert.equal(notes.length, 8);
    const factors = [0.8, 0.73, 0.6, 0.47, 0.33, 0.27, 0.13, 0.04];
    notes.forEach((n, i) => approx(n.amount, u.s.atk * factors[i] * (module ? 1 : 0.8)));
    const first = notes[0].amount;
    h.b.addBuff(u, { key: 'testAttack', mods: { atkPct: 2 } });
    approx(notes[0].amount, first);
    done(h);
  }
});

test('Sakiko grants Fever before dodge and caps penetration by live notes, including the impacting note', () => {
  const { h, u } = field(SAKIKO, 0, { module: true });
  u.profile.noAttack = true;
  cast(u); cast(u);
  const e = h.spawn('dummy', { pos: [10, 7] });
  h.b.addBuff(e, { key: 'testDodge', mods: { dodgePhys: 1 } });
  let penetration;
  h.b.on('hit', (c) => { if (c.source === u) penetration = [c.dmg.defIgnorePct, c.dmg.resIgnorePct]; }, { priority: -100 });
  h.b.dealDamage(u, e, { amount: 1, type: 'phys' });
  approx(penetration[0], 0.6); approx(penetration[1], 0.3);
  assert.equal(e.hp, e.s.maxHp);
  assert.equal(u.mem.oblvnsFever.value, 3);
  done(h);
});

test('Sakiko notes do not jump back to the launch path when a tracked target dies between state updates', () => {
  const { h, u } = field(SAKIKO);
  u.profile.noAttack = true;
  const e = h.spawn('dummy', { pos: [11.6, 6.8] });
  h.step();
  u.profile.attackImpl(h.b, u, [e], { attackId: 1, isSkill: false });
  const n = [...u.mem.oblvnsNotes].at(-1);
  h.run(0.55);
  assert.equal(n.state, 'track');
  const { x, y, dx, dy } = n;
  h.b.kill(e, u);
  h.step();
  approx(n.x - x, dx * 2 / 30);
  approx(n.y - y, dy * 2 / 30);
  h.run(0.4);
  assert.equal(n.target, null);
  done(h);
});

test('Sakiko S2 switches tones, preserves tone on Fever activation and doubles notes during Fever', () => {
  const { h, u } = field(SAKIKO, 1, { module: true });
  approx(u.s.atk, u.base.atk * 1.75);
  cast(u);
  approx(u.s.atk, u.base.atk);
  assert.ok(u.s.aspd >= u.base.aspd + 110);
  u.mem.oblvnsFever.value = 450;
  cast(u);
  approx(u.s.atk, u.base.atk);
  assert.equal(u.skill.rule, 'NEVER');
  const before = u.mem.oblvnsNotes.size;
  u.profile.attackImpl(h.b, u, [], { attackId: 100, isSkill: false });
  assert.equal(u.mem.oblvnsNotes.size, before + 2);
  h.run(20.1);
  assert.equal(u.skill.rule, 'DEFAULT');
  assert.equal(u.mem.oblvnsFever.until, 0);
  done(h);
});

test('Sakiko S3 launches physical/arts pairs toward high RES/DEF; Fever pauses the skill and retires fatal survivors', () => {
  const { h, u } = field(SAKIKO, 2);
  u.profile.noAttack = true;
  h.run(8);
  const armored = h.spawn('dummy', { pos: [10, 7] }), resistant = h.spawn('flyer', { pos: [11, 6] });
  h.b.addBuff(armored, { key: 'testDef', mods: { defFlat: 1000 } });
  h.b.addBuff(resistant, { key: 'testRes', mods: { resFlat: 90 } });
  h.step();
  u.mem.oblvnsFever.value = 450;
  cast(u);
  u.profile.attackImpl(h.b, u, [armored], { attackId: 100, isSkill: true });
  assert.deepEqual([...u.mem.oblvnsNotes].map((n) => n.target?.id), [resistant.id, resistant.id, armored.id, armored.id]);
  h.run(5);
  approx(u.skill.timeLeft, 25);
  h.b.loseHp(u, u.hp + 1, { source: armored });
  assert.ok(u.alive);
  assert.ok(u.mem.oblvnsFever.doomed.has(u));
  h.run(15.1);
  assert.ok(!u.alive || !u.deployed);
  done(h);
});

test('Sakiko clears untracked notes on retreat but already tracking notes still land', () => {
  const { h, u } = field(SAKIKO);
  const e = h.spawn('dummy', { pos: [10, 8] });
  assert.ok(h.runUntil(() => [...u.mem.oblvnsNotes].some((n) => n.state === 'track'), 3));
  h.b.retreat(u, { reason: 'test' });
  const hp = e.hp;
  h.run(6);
  assert.ok(e.hp < hp);
  assert.equal(u.mem.oblvnsNotes.size, 0);
  done(h);
});

test('Makoto Persona has correct HP/ATK/BAT, silence and SP block; All-Out uses body ATK and restores base range', () => {
  for (const module of [false, true]) {
    const { h, u } = field(MAKOTO, 0, { module });
    const e = h.spawn('flyer', { pos: [10, 7] });
    u.profile.noAttack = true;
    h.step();
    cast(u);
    approx(u.s.atk, u.base.atk * (module ? 2 : 1.85));
    approx(u.s.maxHp, u.base.maxHp * (module ? 1.6 : 1.35));
    approx(u.s.interval, 1.6);
    assert.equal(u.s.blockCnt, 0);
    assert.ok(u.s.flags.noSp && u.s.flags.silence);
    assert.equal(u.skill.gainSp(10), 0);
    assert.ok(e.findBuff('sluggish'));
    h.run(21.1);
    const allOut = hits(h, u).filter((c) => c.dmg.tags.includes('makotoAllOut'));
    assert.equal(allOut.length, 1);
    approx(allOut[0].amount, u.base.atk * 4.5);
    approx(u.s.maxHp, u.base.maxHp);
    assert.equal(u.s.blockCnt, 2);
    assert.deepEqual(u.rangeGrid, u.def.rangeGrid);
    done(h);
  }
});

test('Makoto S1 switches between arts attacks and healing at the inclusive half-HP boundary', () => {
  const { h, u } = field(MAKOTO, 0, { others: [{ uid: 2, chessId: 'patient', row: 11, col: 5 }] });
  const a = h.unit(2), e = h.spawn('dummy', { pos: [10, 7] });
  a.profile.noAttack = true;
  a.hp = a.s.maxHp / 2;
  cast(u);
  const before = a.hp;
  assert.ok(h.runUntil(() => a.hp > before, 4));
  approx(a.hp - before, u.s.atk * 0.5);
  assert.ok(h.runUntil(() => e.hp < e.s.maxHp, 3));
  assert.ok(hits(h, u).some((c) => c.type === 'arts'));
  done(h);
});

test('Makoto S2 hits four ground targets, fears, and executes a feared flyer below the threshold', () => {
  const { h, u } = field(MAKOTO, 1);
  for (const pos of [[10, 6], [10, 7], [9, 6], [11, 6]]) h.spawn('dummy', { pos });
  const fly = h.spawn('flyer', { pos: [10, 7] });
  cast(u);
  assert.ok(h.runUntil(() => hits(h, u).length >= 4, 4));
  assert.ok(hits(h, u).every((c) => c.target !== fly && c.type === 'arts'));
  h.run(8);
  assert.ok(h.enemies().some((e) => e.findBuff('fear')));
  fly.hp = u.s.atk * 2.5;
  h.b.applyStatus(fly, 'fear', { duration: 2, source: u });
  h.run(0.2);
  assert.equal(fly.alive, false);
  done(h);
});

test('Makoto S3 uses weakness damage, switches once on fatal damage and heals with restored blocking', () => {
  const { h, u } = field(MAKOTO, 2, { others: [{ uid: 2, chessId: 'patient', row: 11, col: 5 }] });
  const a = h.unit(2), e = h.spawn('flyer', { pos: [10, 7] });
  a.profile.noAttack = true;
  h.b.addBuff(e, { key: 'testRes', mods: { resFlat: 100 } });
  cast(u);
  assert.ok(h.runUntil(() => hits(h, u).some((c) => c.type === 'phys'), 4));
  const left = u.findBuff('trait:substitute').timeLeft;
  h.b.loseHp(u, u.hp + 1, { source: e });
  assert.ok(u.alive);
  assert.equal(u.s.blockCnt, 2);
  assert.ok(u.s.flags.disarm);
  approx(u.findBuff('trait:substitute').timeLeft, left);
  a.hp = a.s.maxHp / 4;
  const hp = a.hp;
  h.run(1.6);
  assert.ok(a.hp > hp);
  approx(a.s.dodgePhys, 0.35);
  h.b.loseHp(u, u.hp + 1, { source: e });
  assert.equal(u.alive, false, 'Orpheus cannot prevent another lethal hit');
  assert.ok(!hits(h, u).some((c) => c.dmg.tags.includes('makotoAllOut')), 'a killed Persona does not return via All-Out');
  done(h);
});

test('both kits replay deterministically with moving targets and repeated deployments', () => {
  function replay() {
    const { h, u } = field(SAKIKO, 2, { others: [{ uid: 2, diy: { slot: 'chess_char_6_diy2_a', charId: MAKOTO, skillIndex: 2 }, elite: true, row: 11, col: 5 }] });
    for (let i = 0; i < 6; i++) h.spawn('dummy', { pos: [10, 6 + i % 3] });
    h.run(35);
    h.b.retreat(u, { reason: 'test' });
    h.run(80);
    done(h);
    return [h.b.snapshot(), h.events];
  }
  assert.deepEqual(replay(), replay());
});
