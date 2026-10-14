// Sakiko Togawa (char_4182_oblvns): travelling notes, shared Fever and all three skills.
// Sources: official tables and https://prts.wiki/w/丰川祥子 (2026-10-14).
import { num, talentBb, skillRec, up } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy, tileKeyOf } from '../../../targeting.js';
import { dirVec, frontOf } from '../../../dir.js';
import { sin, cos, hypot } from '../../../detmath.js';

const ID = 'char_4182_oblvns';
const S1 = 'skchr_oblvns_1', S2 = 'skchr_oblvns_2', S3 = 'skchr_oblvns_3';
const MUJICA = new Set([ID, 'char_4183_mortis', 'char_4184_dolris', 'char_4185_amoris', 'char_4186_tmoris']);
const isMember = (u) => u?.kind === 'op' && MUJICA.has(u.def?.charId);
const FEVERS = new WeakMap();
const PROFILE = Object.freeze({ canHitFly: true });
const TAU = 2 * Math.PI;

function feverOf(battle) {
  let f = FEVERS.get(battle);
  if (f) return f;
  f = { value: 0, until: 0, skills: new Map(), doomed: new Set() };
  FEVERS.set(battle, f);
  battle.on('skillStart', ({ unit, reason }) => {
    if (!isMember(unit) || reason === 'fullNotes' || reason === 'fever' || f.until > battle.time || f.value < 450) return;
    f.value = 0;
    f.until = battle.time + 20;
    f.skills.clear();
    for (const a of battle.allyUnits.filter((u) => up(u) && isMember(u))) {
      f.skills.set(a, { seq: a.deploySeq, free: false, rule: a.skill.rule });
      if (a.skill.id === S2) a.skill.setTrigger('NEVER');
      battle.fx('buff', { id: a.id, x: a.x, y: a.y, kind: 'fever', dur: 20 });
    }
  });
  battle.on('tick', () => {
    if (!f.until) return;
    if (battle.time >= f.until - 1e-9) {
      f.until = 0;
      for (const [a, st] of f.skills) if (up(a) && a.deploySeq === st.seq) {
        if (st.free && a.skill.active) a.skill.end('fever');
        if (a.skill.id === S2) a.skill.setTrigger(st.rule);
      }
      for (const a of f.doomed) if (up(a)) battle.retreat(a, { reason: 'fever' });
      f.doomed.clear();
      f.skills.clear();
      return;
    }
    for (const [a, st] of f.skills) {
      const sk = a.skill;
      if (!up(a) || a.deploySeq !== st.seq || !a.canAct || a.s.flags.silence || sk.id === S2 || sk.active) continue;
      // [ASSUMED] The existing instant-skill cadence also paces free Fever casts; no cast animation is in the tables.
      if (battle.time < sk.nextCastAt - 1e-9) continue;
      st.free = true;
      sk.activate('fever', { free: true });
    }
  });
  return f;
}

// PRTS trajectory parameters: [state update, minimum free time, forward speed, amplitude, tracking speed, turn, radius].
const MOTION = Object.freeze({
  idle: [0.4, 0.1, 1.3, 0.3, 2, 7 / 30, 1], targeted: [0.4, 0.1, 2, 0, 2, 1 / 6, 1],
  burst: [0.2, 0.6, 1.7, 0, 2.2, 1 / 6, 1], piano: [0.2, 0.4, 1.9, 0.4, 3.5, 0.5, 0.8],
  organ: [0.4, 0.4, 0.7, 0.15, 1, 1 / 12, 1], duet: [0.4, 0.8, 0.8, 0.5, 1.3, 0.25, 1],
});

export default {
  [ID]: (bb, chess, def) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const s1 = skillRec(chess, S1), s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const sid = def.skill.id;
    const improved = !!chess.module?.active && chess.module.level >= 2;
    const notes = new Set();
    let organ = false;
    const setTone = (battle, unit) => {
      battle.addBuff(unit, { key: 'oblvns:tone',
        mods: organ ? { aspd: num(s2.bb['attack@attack_speed']) } : { atkPct: num(s2.bb['attack@atk']) } });
      unit.form = organ ? 'organ' : 'piano';
      battle.fx('phase', { id: unit.id, x: unit.x, y: unit.y, form: unit.form });
    };

    function launch(battle, unit, target, { type = 'phys', scale = 1, mode = target ? 'targeted' : 'idle', angle = null,
      attackId = 0, isSkill = false } = {}) {
      const cfg = MOTION[mode];
      const [dr, dc] = dirVec(unit.dir);
      const theta = (angle ?? battle.rng.range(-num(t0['attack@angle'], 20), num(t0['attack@angle'], 20))) * Math.PI / 180;
      const vx = dc * cos(theta) - dr * sin(theta), vy = dr * cos(theta) + dc * sin(theta);
      const penalty = unit.blocking.length || (improved && (sid === S2 || unit.skill.active)) ? 1 : num(chess.trait?.bb?.atk_scale, 0.8);
      const n = { x: unit.x, y: unit.y, dx: vx, dy: vy, ox: unit.x, oy: unit.y, vx, vy,
        state: 'free', elapsed: 0, minFree: cfg[1], visualAt: 0, update: cfg[0], outside: 0, target, targetSeq: target?.deploySeq,
        sign: cfg[3] ? (battle.rng.chance(0.5) ? 1 : -1) : 0, seq: unit.deploySeq, hits: new Set(),
        amount: unit.s.atk * unit.s.atkScaleMul * scale * penalty };
      notes.add(n);
      const valid = () => n.target && n.target.deploySeq === n.targetSeq && canTargetEnemy(unit, n.target, PROFILE);
      const hit = (enemy) => {
        n.hits.add(enemy);
        battle.dealDamage(unit, enemy, { amount: n.amount, type, isAttack: true, isProjectile: true, isSkill,
          attackId, tags: ['oblvnsNote'] });
      };
      const remove = () => { notes.delete(n); return false; };
      battle.addProjectile({ from: unit, visual: type === 'arts' ? 'bolt' : 'arrow', source: unit, data: n,
        advance(p, dt) {
          if ((!up(unit) || unit.deploySeq !== n.seq) && n.state !== 'track') return remove();
          n.elapsed += dt;
          n.update -= dt;
          if (n.state !== 'hit' && n.update <= 1e-9) {
            n.update += cfg[0];
            if (!valid()) {
              n.target = null;
              if (n.state === 'track') {
                n.state = 'free'; n.ox = n.x; n.oy = n.y; n.vx = n.dx; n.vy = n.dy; n.elapsed = 0; n.minFree = 0;
              }
            }
            if (!n.target) {
              const nearby = [...battle.enemiesInRadius(n.x, n.y, cfg[6]), ...battle.allyTargetsInRadius(n.x, n.y, cfg[6], unit)]
                .filter((e) => canTargetEnemy(unit, e, PROFILE));
              nearby.sort((a, b) => hypot(a.x - n.x, a.y - n.y) - hypot(b.x - n.x, b.y - n.y) || a.id - b.id);
              n.target = nearby[0] ?? null; n.targetSeq = n.target?.deploySeq;
            }
            if (n.target && n.elapsed >= n.minFree - 1e-9) n.state = 'track';
          }
          const x = n.x, y = n.y;
          if (n.state === 'track' && valid()) {
            const tx = n.target.x - n.x, ty = n.target.y - n.y, d = hypot(tx, ty);
            if (d <= cfg[4] * dt + 0.05) {
              n.x = n.target.x; n.y = n.target.y;
              hit(n.target);
              if (mode !== 'piano') return remove();
              n.state = 'hit'; n.elapsed = 0;
            } else {
              n.dx = n.dx * (1 - cfg[5]) + tx / d * cfg[5];
              n.dy = n.dy * (1 - cfg[5]) + ty / d * cfg[5];
              const length = hypot(n.dx, n.dy) || 1;
              n.dx /= length; n.dy /= length;
              n.x += n.dx * cfg[4] * dt; n.y += n.dy * cfg[4] * dt;
            }
          } else if (n.state === 'track') {
            // Keep the current heading until the next state update notices the lost target.
            n.x += n.dx * cfg[4] * dt; n.y += n.dy * cfg[4] * dt;
          } else if (n.state === 'hit') {
            if (n.elapsed >= num(s2.bb['attack@passby_delay'], 0.5) - 1e-9) return remove();
            n.x += n.dx * 3 * dt; n.y += n.dy * 3 * dt;
            for (const e of battle.enemiesInRadius(n.x, n.y, 0.8)) if (!n.hits.has(e) && canTargetEnemy(unit, e, PROFILE)) hit(e);
          } else {
            const forward = n.elapsed * cfg[2];
            const side = n.sign * cfg[3] * Math.min(3, Math.floor(forward / TAU) + 1) * sin(forward);
            n.x = n.ox + n.vx * forward - n.vy * side;
            n.y = n.oy + n.vy * forward + n.vx * side;
            const length = hypot(n.x - x, n.y - y);
            if (length > 0) { n.dx = (n.x - x) / length; n.dy = (n.y - y) / length; }
          }
          n.outside = !n.target && !unit.rangeKeySet.has(tileKeyOf(n)) ? n.outside + dt : 0;
          if (n.outside >= num(t0.delay, 1) - 1e-9) return remove();
          p.x = n.x; p.y = n.y; p.tx = n.x + n.dx; p.ty = n.y + n.dy;
          if (battle.time >= n.visualAt) {
            n.visualAt = battle.time + 0.2;
            battle.fx('musicNote', { x: n.x, y: n.y, arts: type === 'arts', dur: 0.24 });
          }
          return true;
        } });
    }
    return {
      skills: {
        [S1]: { kind: 'charges', onStart({ battle, unit }) {
          const attackId = ++battle._attackSeq;
          for (let i = 0; i < 8; i++) launch(battle, unit, null, { type: 'arts', mode: 'burst',
            scale: num(s1.bb[i ? `atk_scale_${i + 1}` : 'atk_scale']), angle: 13.125 - i * 3.75, attackId, isSkill: true });
        } },
        [S2]: { kind: 'instant', onStart({ battle, unit }) {
          const fever = feverOf(battle);
          if (fever.value >= 450 || fever.until > battle.time) return;
          organ = !organ;
          setTone(battle, unit);
        } },
        [S3]: { kind: 'duration', targeting: { rangeGrid: s3.rangeGrid },
          onTick({ battle, unit, skill, dt }) {
            const f = feverOf(battle), st = f.skills.get(unit);
            if (f.until > battle.time && st && !st.free) skill.timeLeft += dt;
          } },
      },
      install(battle, unit) {
        const fever = feverOf(battle);
        unit.mem.oblvnsNotes = notes;
        unit.mem.oblvnsFever = fever;
        unit.profile.attackWithoutTarget = (b, u) => b.grid.tile(...frontOf(u.tileR, u.tileC, u.dir)).pass !== 'NONE';
        unit.profile.attackImpl = (b, u, targets, info) => {
          const target = targets[0] ?? null;
          b._ev(['atk', u.id, target?.id ?? u.id, 'none']);
          if (sid === S3 && u.skill.active) {
            const enemies = b.enemiesInKeys(u.rangeKeys, u, PROFILE);
            const highest = (key) => enemies.slice().sort((a, c) => c.s[key] - a.s[key] || a.id - c.id)[0] ?? null;
            for (const type of ['phys', 'arts']) for (let i = 0; i < 2; i++) launch(b, u, highest(type === 'phys' ? 'res' : 'def'),
              { ...info, isSkill: true, type, mode: 'duet', scale: num(s3.bb['attack@atk_scale']) });
          } else if (sid === S2) {
            for (let i = 0; i < (fever.until > b.time ? 2 : 1); i++) launch(b, u, target,
              { ...info, type: organ ? 'arts' : 'phys', mode: organ ? 'organ' : 'piano' });
          } else launch(b, u, target, info);
        };
        battle.on('hit', (ctx) => {
          if (!up(unit) || !isMember(ctx.source) || ctx.target?.side !== 'enemy') return;
          const count = Math.min(notes.size, num(t0.max_cnt));
          ctx.dmg.defIgnorePct += count * num(t0.def_penetrate_ratio);
          ctx.dmg.resIgnorePct += count * num(t0.magic_resist_penetrate_ratio);
          if (ctx.source === unit && fever.until <= battle.time) fever.value = Math.min(450, fever.value + num(t1.cnt));
        }, { owner: unit, priority: 100 });
        battle.on('fatal', (ctx) => {
          if (up(unit) && sid === S3 && unit.skill.active && fever.until > battle.time && isMember(ctx.unit) && !ctx.prevented) {
            ctx.prevented = true; fever.doomed.add(ctx.unit);
          }
        }, { owner: unit, priority: -3000 });
        battle.on('tick', () => {
          if (!up(unit)) return;
          // Other Sakikos contribute only their base range, so intersecting ranges cannot recurse.
          const base = new Set(unit.baseRangeKeys);
          const extra = new Set();
          for (const a of battle.allyUnits) if (a !== unit && up(a) && isMember(a)) {
            const range = a.def.charId === ID ? absoluteRangeKeys(a.def.rangeGrid, a.tileR, a.tileC, a.dir, a.s.baseRangeExtend) : a.rangeKeys;
            if (range.some((k) => base.has(k))) for (const k of range) extra.add(k);
          }
          battle.setExtraRange(unit, [...extra]);
          for (const a of battle.alliesInGrid(unit).filter((v) => v.kind === 'op')) battle.applyStrongest(a, 'oblvns:tempo',
            { duration: 0.1, value: num(t1.attack_speed), source: unit, mods: (v) => ({ aspd: v }) });
          const sk = unit.skill;
          if (sid === S1 && sk.charges === sk.maxCharges && unit.canAct && !unit.s.flags.silence
              && !sk.opCooling && battle.time >= sk.nextCastAt - 1e-9) sk.activate('fullNotes');
        }, { owner: unit });
        battle.on('deploy', (ctx) => {
          if (ctx.unit !== unit || ctx.move) return;
          organ = false;
          if (sid === S2) { setTone(battle, unit); unit.skill.setTrigger('DEFAULT'); }
        }, { owner: unit });
      },
    };
  },
};
