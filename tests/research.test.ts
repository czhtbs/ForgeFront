import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, soldier, build, connect, disconnect, setFactoryOutput, productionState, stepWorld, allTroops, dispatch, stepBuildingWork } from '../src/sim/world.ts';
import { TECHNOLOGIES, TECH } from '../src/content/research.ts';
import { configuration, canEquip } from '../src/content/equipment.ts';
import { startResearch, stepResearch, researchLevel, maxHealth, moveSpeed, unlocked } from '../src/sim/research.ts';
import { addBattle, reinforce } from '../src/sim/combat.ts';
import { FORT } from '../src/sim/types.ts';
import { encodeState, decodeState, mapData, hashState } from '../src/sim/snapshot.ts';
import { normalizeCommand, submitLocal } from '../src/sim/commands.ts';

function fixture() {
  const w = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal' });
  w.factions.forEach(f => { f.ai = false; f.gold = 100000; });
  w.provinces.forEach(p => { p.owner = 0; p.building = null; p.troops = []; p.mobile = []; });
  build(w, 0, 'researchLab'); build(w, 1, 'researchLab'); for (let i = 0; i < 120; i++) stepBuildingWork(w); return w;
}
const finish = (w, id, lab = 0) => { assert.equal(startResearch(w, lab, id, 0), null); for (let i = 0; i < TECH[id].seconds * 30; i++) stepResearch(w); };

test('30 fixed-price technologies match the complete design and initial recipe locks', () => {
  assert.equal(TECHNOLOGIES.length, 30); assert.equal(new Set(TECHNOLOGIES.map(t => t.id)).size, 30);
  assert.equal(TECHNOLOGIES.reduce((n, t) => n + t.cost, 0), 9630);
  assert.equal(TECHNOLOGIES.reduce((n, t) => n + t.seconds, 0), 1465);
  const w = fixture();
  for (const i of ['rifle', 'sword', 'blast', 'burn', 'frost', 'arc', 'pierce', 'bounce', 'return', 'delay', 'linger', 'rangedLight', 'meleeLight']) assert.ok(unlocked(w, 0, i), i);
  for (const i of ['split', 'trail', 'homing', 'lob', 'far', 'near', 'spread', 'rangedMedium', 'meleeHeavy']) assert.ok(!unlocked(w, 0, i), i);
  build(w, 2, 'attachmentWorks'); assert.match(setFactoryOutput(w, 2, 'split'), /解锁/);
  finish(w, 'split'); assert.equal(setFactoryOutput(w, 2, 'split'), null);
  finish(w, 'medium'); assert.ok(unlocked(w, 0, 'rangedMedium')); assert.ok(unlocked(w, 0, 'meleeMedium'));
});

test('labs research different projects concurrently, charge once and obey prerequisite and disabled state', () => {
  const w = fixture(), gold = w.factions[0].gold;
  assert.ok(startResearch(w, 0, 'heavy', 0)); assert.equal(w.factions[0].gold, gold);
  assert.equal(submitLocal(w, 0, { type: 'research', province: 0, technology: 'blast1' }), null);
  assert.ok(startResearch(w, 0, 'burn1', 0)); assert.ok(startResearch(w, 1, 'blast1', 0));
  assert.equal(startResearch(w, 1, 'burn1', 0), null); assert.equal(w.factions[0].gold, gold - 260);
  w.provinces[0].hp = 0;
  for (let i = 0; i < 750; i++) stepResearch(w);
  assert.equal(researchLevel(w, 0, 'burn'), 1); assert.equal(researchLevel(w, 0, 'blast'), 0); assert.equal(w.provinces[0].research.elapsed, 0);
  w.provinces[0].hp = 1; for (let i = 0; i < 750; i++) stepResearch(w);
  assert.equal(researchLevel(w, 0, 'blast'), 1);
  assert.equal(normalizeCommand(w, 1, { type: 'research', province: 0, technology: 'blast2' }), null);
  assert.equal(normalizeCommand(w, 0, { type: 'research', province: 0, technology: '__proto__' }), null);
  assert.equal(normalizeCommand(w, 0, { type: 'trialResearch', branch: 'blast', level: 3 }), null);
});

test('manual research cancellation refunds unfinished research once and releases the shared project lock', () => {
  const w = fixture(), gold = w.factions[0].gold;
  startResearch(w, 0, 'blast1', 0); stepResearch(w); w.provinces[0].hp = 0;
  assert.equal(normalizeCommand(w, 1, { type: 'cancelResearch', province: 0 }), null);
  const copy = decodeState(encodeState(w), mapData(w));
  for (const world of [w, copy]) assert.equal(submitLocal(world, 0, { type: 'cancelResearch', province: 0 }), null);
  assert.equal(hashState(w), hashState(copy)); assert.equal(w.factions[0].gold, gold); assert.equal(researchLevel(w, 0, 'blast'), 0);
  assert.equal(w.provinces[0].research, undefined); assert.ok(submitLocal(w, 0, { type: 'cancelResearch', province: 0 })); assert.equal(w.factions[0].gold, gold);
  assert.equal(startResearch(w, 1, 'blast1', 0), null);
  for (let i = 0; i < 750; i++) stepResearch(w);
  assert.ok(submitLocal(w, 0, { type: 'cancelResearch', province: 1 })); assert.equal(w.factions[0].gold, gold - 140); assert.equal(researchLevel(w, 0, 'blast'), 1);
  w.settings.training = true; startResearch(w, 1, 'blast2', 0); submitLocal(w, 0, { type: 'cancelResearch', province: 1 }); assert.equal(w.factions[0].gold, gold - 140);
});

test('global upgrades preserve wound and cooldown progress for old troops and cost the same at any army size', () => {
  for (const count of [1, 1000]) {
    const w = fixture(), p = w.provinces[2]; p.troops = Array.from({ length: count }, () => soldier(w, 0));
    const s = p.troops[0]; s.hp = 100; s.recruit = false; s.cooldown = .45; s.artilleryCooldown = .45;
    const gold = w.factions[0].gold; finish(w, 'health1');
    assert.ok(Math.abs(s.hp - 115) < 1e-8); assert.ok(Math.abs(maxHealth(w, s) - 230) < 1e-8); assert.equal(w.factions[0].gold, gold - 180);
    assert.ok(Math.abs(soldier(w, 0, 'hilt').hp - 460) < 1e-8);
    finish(w, 'haste1'); assert.ok(Math.abs(s.cooldown - .45 / 1.1) < 1e-8); assert.equal(s.cooldown, s.artilleryCooldown);
    const before = moveSpeed(w, s); finish(w, 'mobility1'); assert.ok(Math.abs(moveSpeed(w, s) - before * 1.05) < 1e-8);
  }
});

test('research and new equipment survive snapshot restoration and identical command replay', () => {
  const w = fixture(); startResearch(w, 0, 'health1', 0); startResearch(w, 1, 'blast1', 0);
  const s = soldier(w, 0); Object.assign(s, { chip: 'far', rangedArmor: 'rangedHeavy', meleeArmor: 'meleeLight', effects: ['arc', 'trail'], recruit: false }); w.provinces[2].troops = [s];
  const recovered = decodeState(encodeState(w), mapData(w));
  for (let i = 0; i < 1100; i++) { stepWorld(w); stepWorld(recovered); }
  assert.equal(hashState(w), hashState(recovered)); assert.equal(researchLevel(recovered, 0, 'health'), 1);
  assert.equal(recovered.provinces[2].troops[0].rangedArmor, 'rangedHeavy');
});

test('different ammunition inputs stop recruitment, assembly and relay until a conflicting line is disconnected', () => {
  const w = fixture(); build(w, 2, 'barracks'); build(w, 3, 'barracks'); build(w, 4, 'ammoWorks'); build(w, 5, 'ammoWorks');
  setFactoryOutput(w, 4, 'blast'); setFactoryOutput(w, 5, 'arc');
  assert.equal(connect(w, 4, 2), null); assert.equal(connect(w, 2, 3), null); assert.equal(connect(w, 5, 2), null);
  const unit = { ...soldier(w, 0), weapon: null, ammo: null, recruit: true }; w.provinces[2].troops = [unit];
  for (let i = 0; i < 600; i++) stepWorld(w);
  assert.match(productionState(w, 2).error, /冲突/); assert.match(productionState(w, 3).error, /冲突/);
  assert.equal(w.provinces[2].troops.length, 1); assert.equal(w.provinces[3].troops.length, 0); assert.equal(w.shipments.length, 0); assert.equal(w.flows.length, 0);
  assert.equal(setFactoryOutput(w, 5, 'blast'), null); assert.ok(w.provinces[2].ammoConflict);
  disconnect(w, w.routes.find(r => r.from === 5).id);
  assert.equal(productionState(w, 2).error, null); assert.equal(productionState(w, 3).error, null);
  for (let i = 0; i < 120; i++) stepWorld(w);
  assert.ok(allTroops(w).length > 1);
  assert.equal(connect(w, 5, 2), null); assert.equal(productionState(w, 2).error, null);
});

test('one chip and two separate armor slots persist after departure; melee health preserves its fraction', () => {
  const w = fixture();
  assert.ok(configuration(['rifle', 'far', 'near']).error); assert.ok(configuration(['rifle', 'rangedLight', 'rangedHeavy']).error);
  assert.ok(configuration(['sword', 'far']).error); assert.ok(configuration(['rifle', 'lob', 'near']).error);
  const loadout = configuration(['sword', 'spread', 'meleeHeavy', 'rangedMedium', 'frost', 'pierce']); assert.equal(loadout.error, null);
  const s = { ...soldier(w, 0, 'hilt'), ...loadout, recruit: true }; w.provinces[2].troops = [s];
  assert.ok(!canEquip(s, 'far')); assert.ok(!canEquip(s, 'rangedLight')); assert.equal(moveSpeed(w, s), 16 * .7);
  assert.equal(dispatch(w, 2, w.provinces[2].neighbors[0], 1), null);
  for (let i = 0; i < 1500 && w.shipments.length; i++) stepWorld(w);
  const arrived = allTroops(w).find(t => t.id === s.id); assert.equal(arrived.chip, 'spread'); assert.equal(arrived.meleeArmor, 'meleeHeavy'); assert.equal(arrived.recruit, false);
});

test('capturing a lab cancels its project without refund or stealing completed technologies', () => {
  const w = fixture(); finish(w, 'blast1'); startResearch(w, 0, 'health1', 0); const gold = w.factions[0].gold;
  const p = w.provinces[0], b = addBattle(w, 0, [soldier(w, 1)]); reinforce(w, b);
  b.fighters[0].x = FORT.x; b.fighters[0].y = FORT.y; p.hp = 0;
  stepWorld(w); assert.equal(p.owner, 1); assert.equal(p.research, undefined); assert.equal(w.factions[0].gold, gold);
  assert.equal(researchLevel(w, 0, 'blast'), 1); assert.equal(researchLevel(w, 1, 'blast'), 0); assert.equal(researchLevel(w, 0, 'health'), 0);
});

test('sword assembly changes a wounded recruit to 400 maximum health without healing its fraction', () => {
  const w = fixture(); build(w, 2, 'barracks'); build(w, 3, 'launcherWorks'); setFactoryOutput(w, 3, 'sword'); connect(w, 3, 2);
  const s = { ...soldier(w, 0), weapon: null, ammo: null, hp: 100, recruit: true }; w.provinces[2].troops = [s];
  for (let i = 0; i < 900 && !s.weapon; i++) stepWorld(w);
  assert.equal(s.weapon, 'hilt'); assert.equal(s.hp, 200); assert.equal(maxHealth(w, s), 400);
});
