// Makoto Yuki (char_4217_makoto): three Personas, Wild Card and All-Out Attack.
// Sources: official character/skill/battle_equip tables; https://prts.wiki/w/结城理 (2026-10-14).
// In this automatic battle mode S3 keeps Thanatos until fatal damage calls Orpheus; no manual recast UI exists.

import { num, talentBb, traitBb, skillRec, batMod, up } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { weaknessRetype } from '../../items/battle.js';
import { DOLL_SWITCH } from '../../../professions.js';

const ID = 'char_4217_makoto';
const S1 = 'skchr_makoto_1', S2 = 'skchr_makoto_2', S3 = 'skchr_makoto_3';
const FORM = 'makoto:persona';

export default {
  [ID]: (bb, chess, def) => {
    const talent = talentBb(chess, 0), captain = talentBb(chess, 1), trait = traitBb(chess);
    const sid = def.skill.id;
    const area = skillRec(chess, sid).rangeGrid;
    const b = skillRec(chess, sid).bb;
    const enter = ({ battle, unit }) => {
      if (unit.trait.doll && sid === S3) unit.mem.makotoOrpheus?.();
      else battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
    };
    return {
      skills: {
        [S1]: { kind: 'instant', onStart: enter },
        [S2]: { kind: 'instant', onStart: enter },
        [S3]: { kind: 'instant', onStart: enter },
      },
      install(battle, unit) {
        const body = { ...unit.profile }, bodyRange = unit.rangeGrid;
        let mode = 'body', nextHeal = 0, nextExecute = 0;
        const executed = new Set();
        const keys = () => absoluteRangeKeys(area, unit.tileR, unit.tileC, unit.dir, 0);
        const enemies = (air = true) => battle.enemiesInKeys(keys(), unit, { canHitFly: air });
        const reset = () => {
          mode = 'body';
          unit.form = null;
          unit.profile = { ...body };
          unit.rangeGrid = bodyRange;
          battle.removeBuff(unit, FORM);
          executed.clear();
          battle.refreshRange(unit);
        };
        const configure = (healer = false) => {
          mode = healer ? 'orpheus' : sid === S1 ? 'healingAttack' : 'thanatos';
          const substitute = unit.findBuff('trait:substitute');
          if (substitute) {
            // The engine owns the unchanged expiry; S3's second switch does not restart its twenty seconds.
            substitute.mods.blockCnt = healer ? 0 : -99;
            substitute.flags.silence = sid !== S3 || healer;
          }
          battle.addBuff(unit, {
            key: FORM,
            mods: { atkPct: num(talent.atk), hpPct: num(talent.max_hp_t1) + num(trait.max_hp),
              batPct: batMod(talent.base_attack_time, chess), aspd: sid === S3 && !healer ? num(b['talent@attack_speed']) : 0 },
            flags: { disarm: healer },
          });
          unit.profile = { ...body, dmgType: 'arts', attack: 'melee', projectile: 'none',
            canHitFly: sid === S3, atkScale: num(b['attack@atk_scale']),
            maxTargets: sid === S1 ? 1 : num(b['attack@max_target'], 1) };
          unit.rangeGrid = area;
          if (sid === S1) unit.profile.canAttack = () => {
            const heal = battle.injuredAlliesInKeys(keys(), unit).some((a) => a.hpRatio <= 0.5);
            unit.profile.dmgType = heal ? 'heal' : 'arts';
            unit.profile.heal = heal ? { mode: 'single' } : null;
            unit.profile.atkScale = num(b[heal ? 'attack@heal_scale' : 'attack@atk_scale']);
            return true;
          };
          unit.markDirty();
          battle.refreshRange(unit);
          unit.hp = unit.s.maxHp;
          nextHeal = battle.time + DOLL_SWITCH;
          unit.form = healer ? 'orpheus3' : sid === S1 ? 'orpheus' : sid === S2 ? 'thanatos' : 'thanatos3';
          battle.fx('phase', { id: unit.id, x: unit.x, y: unit.y, form: unit.form });
        };
        const orpheus = () => {
          if (!up(unit) || mode !== 'thanatos' || sid !== S3 || unit.trait.dollSwitching) return false;
          configure(true);
          unit.trait.dollSwitching = true;
          const seq = unit.deploySeq;
          battle.addBuff(unit, { key: 'makoto:switch', duration: DOLL_SWITCH,
            flags: { invulnerable: true, noSp: true, noHeal: true, healFree: true, isolated: true, disarm: true },
            onExpire: () => {
              if (!up(unit) || unit.deploySeq !== seq) return;
              unit.trait.dollSwitching = false;
              unit.hp = unit.s.maxHp;
            } });
          return true;
        };
        unit.mem.makotoOrpheus = orpheus;
        battle.on('dollSwap', (ctx) => {
          if (ctx.unit !== unit || !up(unit)) return;
          if (ctx.form === 'doll') {
            configure();
            for (const e of enemies()) battle.applyStatus(e, 'sluggish', { duration: num(talent.sluggish), source: unit });
          } else {
            reset();
            // The All-Out form uses the body's ATK, without the Persona's ATK/HP bonus.
            // The extracted All-Out loop + ending clips total 1.6 seconds.
            unit.form = 'allOut';
            const seq = unit.deploySeq;
            battle.fx('phase', { id: unit.id, x: unit.x, y: unit.y, form: unit.form });
            battle.addBuff(unit, { key: 'makoto:allOut', duration: 1.6,
              flags: { silence: true, invulnerable: true, noSp: true, disarm: true },
              onExpire: () => {
                if (!up(unit) || unit.deploySeq !== seq) return;
                unit.form = null;
                battle.fx('phase', { id: unit.id, x: unit.x, y: unit.y, form: null });
              } });
            for (const e of enemies()) battle.dealDamage(unit, e, {
              amount: unit.s.atk * num(captain.atk_scale), type: 'true', isSkill: false, tags: ['talent', 'makotoAllOut'],
            });
            battle.fx('aoe', { id: unit.id, x: unit.x, y: unit.y, radius: 2, skill: 'makotoAllOut' });
          }
        }, { owner: unit });
        battle.on('fatal', (ctx) => {
          if (ctx.unit === unit && !ctx.prevented && up(unit) && orpheus()) ctx.prevented = true;
        }, { owner: unit, priority: -99 });
        battle.on('hit', (ctx) => {
          if (ctx.source === unit && ctx.dmg.isAttack && sid === S3 && mode === 'thanatos') weaknessRetype(ctx.dmg, unit, ctx.target);
        }, { owner: unit, priority: 5 });
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !ctx.dmg?.isAttack || sid !== S2 || mode !== 'thanatos' || !up(unit) || !ctx.target.alive) return;
          if (battle.rng.chance(num(b['attack@prob']))) battle.applyStatus(ctx.target, 'fear', { duration: num(b['attack@fear']), source: unit });
        }, { owner: unit });
        battle.on('tick', () => {
          if (!up(unit) || !unit.trait.doll || unit.trait.dollSwitching) return;
          if (sid === S2 && battle.time >= nextExecute - 1e-9) {
            nextExecute = battle.time + 0.1;
            const foes = enemies();
            for (const e of executed) if (!foes.includes(e)) executed.delete(e);
            for (const e of foes) if (!executed.has(e) && e.s.flags.fear && e.hp <= unit.s.atk * num(b['attack@kill_atk_scale'])) {
              executed.add(e);
              battle.dealDamage(unit, e, { amount: num(b['attack@kill_damage']), type: 'true', canDodge: false,
                sourceless: true, tags: ['execute'] });
            }
          }
          if (mode !== 'orpheus') return;
          const allies = battle.alliesInGrid(unit).filter((a) => a.kind === 'op');
          for (const a of allies) battle.applyStrongest(a, 'makoto:dodge', { duration: 0.1,
            value: num(b['attack@prob']), source: unit, mods: (v) => ({ dodgePhys: v, dodgeArts: v }) });
          if (battle.time < nextHeal - 1e-9) return;
          nextHeal += num(b['attack@interval'], 1);
          const targets = battle.injuredAlliesInKeys(keys(), unit).sort((a, c) => a.hpRatio - c.hpRatio || a.id - c.id)
            .slice(0, num(b['attack@max_target_heal']));
          const seq = unit.deploySeq;
          battle.after(0.5, () => {
            if (!up(unit) || unit.deploySeq !== seq || mode !== 'orpheus') return;
            for (const a of targets) if (up(a)) battle.heal(unit, a, unit.s.atk * num(b['attack@heal_scale']));
          }, { owner: unit });
        }, { owner: unit });
        battle.on('death', (ctx) => { if (ctx.unit === unit) reset(); }, { owner: unit });
        battle.on('deploy', (ctx) => { if (ctx.unit === unit && !ctx.move) reset(); }, { owner: unit });
      },
    };
  },
};
