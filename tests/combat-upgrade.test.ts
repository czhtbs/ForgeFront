import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, soldier } from '../src/sim/world.ts';
import { fireAttack, stepAttacks, triggerEffect, attackTargets, hurt } from '../src/sim/attacks.ts';
import { addBattle, stepBattle } from '../src/sim/combat.ts';
import { attackInterval, setTrialResearch, moveSpeed } from '../src/sim/research.ts';
import { toBattle, toWorld } from '../src/sim/spatial.ts';
import { encodeState, decodeState, mapData, hashState } from '../src/sim/snapshot.ts';
import { inside, distance } from '../src/sim/map.ts';
import { unitPanel, researchPanel, soldierPortrait } from '../src/ui/equipmentView.ts';

function range(effects = [], positions = [[15, 0]]) {
  const w = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal', training: true });
  w.provinces.forEach(p => { p.owner = 0; p.building = null; p.troops = []; p.mobile = []; });
  const shooter = { ...soldier(w, 0), effects, position: { x: 0, y: 0 } }, enemies = positions.map(([x, y]) => ({ ...soldier(w, 1), hp: 10000, position: { x, y } }));
  w.provinces[0].troops = [shooter, ...enemies]; return { w, shooter, enemies };
}
const advance = (w, seconds) => { for (let i = 0; i < Math.round(seconds * 30); i++) { w.tick++; w.time = w.tick / 30; stepAttacks(w); } };
const fire = ({ w, shooter, enemies }) => fireAttack(w, shooter, shooter.position, enemies[0]?.position ?? { x: 36, y: 0 }, 0, enemies[0]?.id);

test('fixed armor subtracts from each direct/effect hit; arc ignores both armor slots', () => {
  const r = range(['blast'], [[15, 0]]); r.enemies[0].rangedArmor = 'rangedMedium'; fire(r); advance(r.w, .3);
  assert.equal(r.enemies[0].hp, 9950);
  const a = range(['arc']); a.enemies[0].rangedArmor = 'rangedHeavy'; a.enemies[0].meleeArmor = 'meleeHeavy'; fire(a); advance(a.w, .3); assert.equal(a.enemies[0].hp, 9950);
  const target = attackTargets(a.w)[1]; hurt(a.w, target, 0, 10, a.shooter.position); assert.equal(target.unit.hp, 9950);
});

test('pierce deals full damage and uses its primary effect at the first hit only', () => {
  const r = range(['pierce', 'blast'], [[6, 0], [18, 0], [30, 0]]); fire(r); advance(r.w, .4);
  assert.deepEqual(r.enemies.map(s => s.hp), [9910, 9950, 9950]); assert.equal(r.w.visuals.filter(v => v.kind === 'blast').length, 1);
});

test('arc has no passive flight attack and splits only after the primary trigger', () => {
  const r = range(['arc', 'split', 'trail', 'return', 'pierce'], [[15, 0], [16, 4], [16, -4]]); fire(r);
  advance(r.w, 1 / 30); assert.deepEqual(r.enemies.map(s => s.hp), [10000, 10000, 10000]);
  advance(r.w, .1333333333);
  const children = r.w.projectiles.filter(p => p.leaf); assert.equal(children.length, 3);
  for (const p of children) { assert.equal(p.damage, 50); assert.equal(p.triggered, false); assert.deepEqual(p.effects, ['arc', 'trail', 'return', 'pierce']); assert.equal(p.initialRange, 12); assert.equal(p.trail, 0); }
});

test('trail has four full-strength extra triggers per projectile; split produces at most twenty', () => {
  const r = range(['burn', 'split', 'trail', 'return'], []); fire(r); advance(r.w, 1.3);
  assert.equal(r.w.fields.length, 20); assert.ok(r.w.fields.every(f => f.damage === 10));
  advance(r.w, 8); assert.equal(r.w.projectiles.length, 0); assert.equal(r.w.fields.length, 0);
});

test('delay reserves each trigger at its location and reads technology at release, with identical restored state', () => {
  const r = range(['blast', 'trail', 'delay'], []); fire(r); advance(r.w, .4);
  assert.equal(r.w.pendingEffects.length, 5); assert.equal(r.w.visuals.filter(v => v.kind === 'blast').length, 0);
  assert.deepEqual(r.w.pendingEffects.map(p => Math.round(p.x * 10) / 10), [7.2, 14.4, 21.6, 28.8, 36]);
  setTrialResearch(r.w, 0, 'blast', 3); const recovered = decodeState(encodeState(r.w), mapData(r.w));
  advance(r.w, .8); advance(recovered, .8); assert.equal(hashState(r.w), hashState(recovered));
  assert.equal(r.w.pendingEffects.length, 0); assert.ok(r.w.visuals.filter(v => v.kind === 'blast').every(v => v.radius === 12));
});

test('burn ticks exactly sixteen times over four seconds, overlaps do not stack and reentry cannot reset ticks', () => {
  const r = range([], [[0, 0]]), source = { owner: 0, province: 0, weapon: 'launcher' };
  for (let i = 0; i < 10; i++) triggerEffect(r.w, source, 'burn', { x: 0, y: 0 });
  advance(r.w, 4); assert.equal(r.enemies[0].hp, 9840); assert.equal(r.w.fields.length, 0);
  advance(r.w, 1 / 30); assert.equal(r.enemies[0].burning, 0);
  r.enemies[0].rangedArmor = 'rangedLight'; triggerEffect(r.w, source, 'burn', { x: 0, y: 0 }); advance(r.w, .3); assert.equal(r.enemies[0].hp, 9840);
  const lifetime = r.w.fields[0].life; setTrialResearch(r.w, 0, 'burn', 1); advance(r.w, .3); assert.ok(r.enemies[0].hp < 9840); assert.ok(r.w.fields[0].life < lifetime);
  const hp = r.enemies[0].hp; r.enemies[0].position.x = 100; advance(r.w, 1 / 30); assert.equal(r.enemies[0].burning, 0);
  r.enemies[0].position.x = 0; advance(r.w, 1 / 30); assert.equal(r.enemies[0].hp, hp);
});

test('frost deals no damage, does not stack, keeps elapsed freeze time on upgrade and clears on exit', () => {
  const r = range([], [[0, 0]]), source = { owner: 0, province: 0, weapon: 'launcher' };
  for (let i = 0; i < 8; i++) triggerEffect(r.w, source, 'frost', { x: 0, y: 0 });
  advance(r.w, 1); assert.ok(Math.abs(r.enemies[0].chill - 50) < 1e-6); assert.equal(r.enemies[0].hp, 10000);
  advance(r.w, 1); assert.equal(r.enemies[0].frozen, 1);
  advance(r.w, .3); setTrialResearch(r.w, 0, 'frost', 3); advance(r.w, 1 / 30);
  assert.ok(Math.abs(r.enemies[0].frozen - (1.5 - 1 / 3)) < 1e-6);
  r.enemies[0].position.x = 100; advance(r.w, 1 / 30); assert.equal(r.enemies[0].frozen, 0); assert.equal(r.enemies[0].chill, 0); assert.equal(r.enemies[0].frostImmune, 1);
});

test('continuous highest-level frost includes a thaw immunity interval instead of permanent freeze', () => {
  const r = range([], [[0, 0]]); setTrialResearch(r.w, 0, 'frost', 3);
  let wasFrozen = false, thawed = false, immuneSteps = 0;
  for (let i = 0; i < 180; i++) {
    if (i % 60 === 0) triggerEffect(r.w, { owner: 0, province: 0, weapon: 'launcher' }, 'frost', { x: 0, y: 0 });
    advance(r.w, 1 / 30); const s = r.enemies[0];
    if (s.frozen > 0) wasFrozen = true;
    if (wasFrozen && s.frostImmune > 0) { thawed = true; immuneSteps++; assert.equal(s.chill, 0); assert.equal(s.frozen, 0); }
  }
  assert.ok(thawed); assert.ok(immuneSteps >= 29);
});

test('local tactical chips kite, close distance or divide targets without leaving the province', () => {
  for (const chip of ['far', 'near', 'spread']) {
    const { w } = range(); const p = w.provinces[0]; p.troops = []; const b = addBattle(w, 0, []);
    const unit = (owner, x, y) => ({ ...soldier(w, owner), ...toBattle(p, { x, y }), position: { x, y }, angle: 0, cooldown: 100, recoil: 0, suppressed: 0 });
    const a = unit(0, p.x - 15, p.y + 15), c = unit(0, p.x - 15, p.y + 20), e = unit(1, p.x + 5, p.y + 15), f = unit(1, p.x + 6, p.y + 20);
    a.chip = c.chip = chip; b.fighters = [a, c, e, f]; const before = a.x; stepBattle(w, b);
    if (chip === 'far') assert.ok(a.x < before); if (chip === 'near') assert.ok(a.x > before); if (chip === 'spread') assert.notEqual(a.target, c.target);
    assert.ok(inside(a.position, p.polygon));
  }
});

test('three modifiers and one payload stay below 1.5 seconds including artillery; equipment UI separates slots', () => {
  const { w, shooter } = range(['split', 'trail', 'lob', 'burn']); assert.equal(attackInterval(w, shooter), 1.3);
  shooter.rangedArmor = 'rangedHeavy'; shooter.meleeArmor = 'meleeLight'; shooter.chip = 'spread';
  shooter.hp = 136;
  const panel = unitPanel(w, [shooter]); assert.match(panel, /soldier-portrait/); for (const name of ['远程防具', '近战防具', '武器配件', '战术芯片']) assert.ok(panel.includes(name));
  assert.match(panel, /血量<b>200<\/b>/);
  setTrialResearch(w, 0, 'health', 1); assert.match(unitPanel(w, [shooter]), /血量<b>230<\/b>/);
  assert.match(panel, /data-tooltip="每 0.25 秒 10 伤害/); assert.match(panel, /assets\/icons\/spread.svg/);
  assert.notEqual(soldierPortrait(shooter, 0x208a8c), soldierPortrait({ ...shooter, rangedArmor: undefined }, 0x208a8c));
  w.provinces[0].building = 'researchLab'; const markup = researchPanel(w, 0, 'effects');
  assert.equal((markup.match(/class="research-card/g) ?? []).length, 12); assert.match(markup, /data-tooltip="爆炸伤害 40 → 50\n范围 8 → 9\n140 金 · 25 秒/);
});
