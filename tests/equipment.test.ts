import test from 'node:test';
import assert from 'node:assert/strict';
import { AMMO, WEAPONS, REMOTE_ONLY, canFight, configuration, isWorkshop } from '../src/content/equipment.ts';
import { build, connect, createWorld, dispatch, localTroops, productionState, setFactoryOutput, soldier, stepWorld } from '../src/sim/world.ts';
import { runAI } from '../src/ai/strategy.ts';

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
  const kind = item in WEAPONS ? 'launcherWorks' : item in AMMO ? 'ammoWorks' : 'attachmentWorks';
  assert.equal(build(w, id, kind), null);
  assert.equal(setFactoryOutput(w, id, item), null);
  assert.equal(connect(w, id, 0), null);
  return w.provinces[id];
}

test('each workshop is a separate building with category-restricted output and no recruits', () => {
  const { w } = factoryWorld(); const before = w.factions[0].gold;
  for (const [id, item] of [[1, 'hilt'], [2, 'blade'], [3, 'blast']]) supply(w, id, item);
  assert.equal(w.factions[0].gold, before - 330);
  assert.ok(setFactoryOutput(w, 1, 'round')); assert.ok(setFactoryOutput(w, 2, 'pierce')); assert.ok(setFactoryOutput(w, 3, 'launcher'));
  assert.deepEqual(w.provinces.slice(1, 4).map(p => p.output), ['hilt', 'blade', 'blast']);
  advance(w, 30);
  for (const p of w.provinces.slice(1, 4)) assert.equal(p.troops.length + p.mobile.length, 0);
});

test('one required component alone leaves everyone unarmed, in either delivery order', () => {
  for (const first of ['launcher', 'round']) {
    const { w, home, unit } = factoryWorld(); supply(w, 1, first); advance(w, 25);
    assert.ok(home.troops.every(s => !canFight(s)));
    assert.match(productionState(w, home.id).status, first === 'launcher' ? /弹药/ : /发射器/);
    assert.ok(dispatch(w, home.id, home.neighbors[0]));
    supply(w, 2, first === 'launcher' ? 'round' : 'launcher'); advance(w, 25);
    assert.equal(canFight(unit), true); assert.equal(unit.weapon, 'launcher'); assert.equal(unit.ammo, 'round');
    assert.equal('stock' in home, false);
  }
});

test('accessory-only supply never arms a recruit; later base components retain the accessory', () => {
  const { w, home, unit } = factoryWorld(); supply(w, 1, 'burn'); advance(w, 25);
  assert.deepEqual(unit.effects, ['burn']); assert.equal(canFight(unit), false);
  supply(w, 2, 'launcher'); supply(w, 3, 'round'); advance(w, 25);
  assert.ok(canFight(unit)); assert.deepEqual(unit.effects, ['burn']);
  assert.ok(home.troops.some(canFight));
});

test('late accessories retrofit ready recruits but never a departed or returned army', () => {
  const { w, home, unit } = factoryWorld(); supply(w, 1, 'launcher'); supply(w, 2, 'round'); advance(w, 25);
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
  supply(w, 1, 'launcher').level = 4; supply(w, 2, 'round').level = 4; supply(w, 3, 'burn').level = 2; supply(w, 4, 'pierce').level = 1;
  advance(w, 45);
  assert.ok(home.troops.some(s => canFight(s) && s.effects.length === 0));
  assert.ok(home.troops.some(s => canFight(s) && s.effects.length === 2));
  advance(w, 230);
  assert.deepEqual(home.troops.map(s => s.id), ids);
  assert.ok(home.troops.every(s => canFight(s) && s.effects.length === 2));
  assert.equal(productionState(w, 0).rate, 0);
  home.troops.splice(0, 10); advance(w, 1); assert.equal(home.troops.length, 50);
});

test('loadout conflicts reject changes while new ranged combinations and melee enchantments work', () => {
  assert.ok(configuration(['launcher', 'hilt']).error);
  assert.ok(configuration(['round', 'beam']).error);
  assert.ok(configuration(['hilt', 'round']).error);
  assert.ok(configuration(['launcher', 'blade']).error);
  for (const effect of REMOTE_ONLY) assert.ok(configuration(['hilt', 'blade', effect]).error, effect);
  assert.equal(configuration(['hilt', 'blade', 'blast', 'arc', 'burn', 'frost', 'pierce']).error, null);
  assert.equal(configuration(['launcher', 'round', 'pierce', 'split', 'burn', 'blast']).error, null);
  assert.ok(configuration(['launcher', 'beam', 'lob']).error);
  const { w } = factoryWorld(); supply(w, 1, 'hilt'); supply(w, 2, 'blade');
  assert.ok(setFactoryOutput(w, 1, 'launcher')); assert.equal(w.provinces[1].output, 'hilt');
  assert.equal(build(w, 3, 'attachmentWorks'), null); setFactoryOutput(w, 3, 'return');
  assert.ok(connect(w, 3, 0)); assert.equal(w.routes.length, 2);
});

test('starting armies have both components and AI supplies both factory categories', () => {
  const w = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal' });
  assert.ok(w.provinces[w.factions[0].hq].troops.every(s => canFight(s) && s.weapon && s.ammo));
  advance(w, 80);
  const works = w.provinces.filter(p => p.owner === 1 && isWorkshop(p.building));
  assert.ok(works.some(p => p.building === 'launcherWorks'));
  assert.ok(works.some(p => p.building === 'ammoWorks'));
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
