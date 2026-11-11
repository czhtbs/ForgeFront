import test from 'node:test';
import assert from 'node:assert/strict';
import { LAUNCHERS, REMOTE_ONLY, canFight, configuration, isWorkshop, workshopFor } from '../src/content/equipment.ts';
import { build, connect, createWorld, dispatch, localTroops, productionState, setFactoryOutput, soldier, stepWorld } from '../src/sim/world.ts';
import { runAI } from '../src/ai/strategy.ts';
import { stepLocalWorld } from '../src/sim/lockstep.ts';

const advance = (w, seconds) => { for (let i = 0; i < seconds * 30; i++) stepWorld(w); };
function factoryWorld() {
  const w = createWorld({ seed: 4521, count: 12, enemies: 1, difficulty: 'normal' });
  w.factions.forEach(f => f.ai = false);
  w.provinces.forEach(p => { p.owner = 0; p.building = null; p.troops = []; p.mobile = []; });
  w.factions[0].gold = 10000;
  const home = w.provinces[0]; home.building = 'barracks';
  const unit = { ...soldier(w, 0), weapon: null, ammo: null, recruit: true }; home.troops = [unit];
  return { w, home, unit };
}
function supply(w, id, item) {
  const kind = workshopFor(item);
  assert.equal(build(w, id, kind), null);
  assert.equal(setFactoryOutput(w, id, item), null);
  assert.equal(connect(w, id, 0), null);
  return w.provinces[id];
}

test('each workshop is a separate building with category-restricted output and no recruits', () => {
  const { w } = factoryWorld(); const before = w.factions[0].gold;
  for (const [id, item] of [[1, 'sword'], [2, 'blast']]) supply(w, id, item);
  assert.equal(w.factions[0].gold, before - 250);
  assert.ok(setFactoryOutput(w, 1, 'pierce')); assert.ok(setFactoryOutput(w, 2, 'rifle'));
  assert.deepEqual(w.provinces.slice(1, 3).map(p => p.output), ['sword', 'blast']);
  advance(w, 30);
  for (const p of w.provinces.slice(1, 3)) assert.equal(p.troops.length + p.mobile.length, 0);
});

test('each complete weapon alone arms recruits with its original attack combination', () => {
  for (const [item, base] of Object.entries(LAUNCHERS)) {
    const { w, home, unit } = factoryWorld();
    assert.match(productionState(w, home.id).status, /武器/);
    supply(w, 1, item); advance(w, 25);
    assert.equal(canFight(unit), true); assert.equal(unit.weapon, base.weapon); assert.equal(unit.ammo, base.ammo);
    assert.equal(dispatch(w, home.id, home.neighbors[0]), null);
    assert.equal('stock' in home, false);
  }
});

test('accessory-only supply never arms a recruit; later base components retain the accessory', () => {
  const { w, home, unit } = factoryWorld(); supply(w, 1, 'burn'); advance(w, 25);
  assert.deepEqual(unit.effects, ['burn']); assert.equal(canFight(unit), false);
  supply(w, 2, 'rifle'); advance(w, 25);
  assert.ok(canFight(unit)); assert.deepEqual(unit.effects, ['burn']);
  assert.ok(home.troops.some(canFight));
});

test('late accessories retrofit ready recruits but never a departed or returned army', () => {
  const { w, home, unit } = factoryWorld(); supply(w, 1, 'rifle'); advance(w, 25);
  supply(w, 3, 'pierce'); advance(w, 25); assert.deepEqual(unit.effects, ['pierce']);
  const target = home.neighbors[0];
  assert.equal(dispatch(w, home.id, target, 1, 0, undefined, new Set([unit.id])), null);
  for (let i = 0; i < 6000 && w.shipments.length; i++) stepWorld(w);
  assert.equal(dispatch(w, target, home.id, 1, 0, undefined, new Set([unit.id])), null);
  for (let i = 0; i < 6000 && w.shipments.length; i++) stepWorld(w);
  supply(w, 4, 'arc'); advance(w, 25);
  const returned = localTroops(w, home.id).find(s => s.id === unit.id)!;
  assert.equal(returned.recruit, false); assert.deepEqual(returned.effects, ['pierce']); assert.equal(returned.ammo, 'round');
  assert.ok(home.troops.some(s => s.recruit && s.effects.includes('arc')));
});

test('assembly at capacity keeps partial configurations and does not bank unused production', () => {
  const { w, home } = factoryWorld();
  home.troops = Array.from({ length: 60 }, () => ({ ...soldier(w, 0), weapon: null, ammo: null, recruit: true }));
  const ids = home.troops.map(s => s.id);
  supply(w, 1, 'rifle').level = 4; supply(w, 3, 'burn').level = 2; supply(w, 4, 'pierce').level = 1;
  advance(w, 45);
  assert.ok(home.troops.some(s => canFight(s) && s.effects.length === 0));
  assert.ok(home.troops.some(s => canFight(s) && s.effects.length === 2));
  advance(w, 500);
  assert.deepEqual(home.troops.map(s => s.id), ids);
  assert.ok(home.troops.every(s => canFight(s) && s.effects.length === 2));
  assert.equal(productionState(w, 0).rate, 0);
  home.troops.splice(0, 10); advance(w, 1); assert.equal(home.troops.length, 50);
});

test('loadout conflicts reject changes while new ranged combinations and melee enchantments work', () => {
  for (const items of [['rifle', 'sword']]) assert.ok(configuration(items).error);
  for (const effect of REMOTE_ONLY) assert.ok(configuration(['sword', effect]).error, effect);
  for (const effect of ['blast', 'arc', 'burn', 'frost']) assert.equal(configuration(['sword', effect, 'pierce']).error, null);
  assert.ok(configuration(['sword', 'blast', 'arc']).error);
  assert.equal(configuration(['rifle', 'pierce', 'split', 'burn']).error, null);
  assert.ok(configuration(['rifle', 'burn', 'blast']).error);
  assert.ok(configuration(['sword', 'lob']).error);
  const { w } = factoryWorld(); w.factions[0].research.push('lob'); supply(w, 1, 'rifle'); supply(w, 2, 'lob');
  assert.ok(setFactoryOutput(w, 1, 'sword')); assert.equal(w.provinces[1].output, 'rifle');
  assert.equal(build(w, 3, 'launcherWorks'), null); setFactoryOutput(w, 3, 'sword');
  assert.ok(connect(w, 3, 0)); assert.equal(w.routes.length, 2);
});

test('starting armies are armed and AI supplies weapons and attachments through category-specific factories', () => {
  const w = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal' });
  assert.ok(w.provinces[w.factions[0].hq].troops.every(s => canFight(s) && s.weapon && s.ammo));
  for (let i = 0; i < 80 * 30; i++) stepLocalWorld(w);
  const works = w.provinces.filter(p => p.owner === 1 && isWorkshop(p.building));
  assert.ok(works.some(p => p.building === 'launcherWorks'));
  assert.ok(works.some(p => p.building === 'attachmentWorks'));
  assert.ok(w.provinces.some(p => [...p.troops, ...p.mobile].some(s => s.owner === 1 && s.recruit && canFight(s))));
});

test('AI assembles compatible melee and artillery groups with the same production rules', () => {
  const w = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal', training: true });
  w.provinces.forEach(p => { p.owner = 1; p.building = null; p.troops = []; p.mobile = []; });
  for (const p of w.provinces.slice(0, 3)) p.building = 'barracks';
  w.factions[1].gold = 10000;
  for (let i = 0; i < 24; i++) { runAI(w, 1); advance(w, 5); }
  const melee = w.provinces[1].troops, artillery = w.provinces[2].troops;
  assert.ok(melee.some(s => canFight(s) && s.weapon === 'hilt' && s.ammo === 'blade' && s.effects.includes('pierce')));
  assert.ok(artillery.some(s => canFight(s) && s.effects.includes('lob') && s.effects.includes('homing') && s.effects.includes('blast')));
});
