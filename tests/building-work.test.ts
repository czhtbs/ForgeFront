import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, soldier, build, upgrade, demolish, cancelUpgrade, stepBuildingWork, stepWorld, buildingWorkPaused, startingLandBonus, connect } from '../src/sim/world.ts';
import { addBattle, reinforce } from '../src/sim/combat.ts';
import { hurtBuilding } from '../src/sim/attacks.ts';
import { FORT } from '../src/sim/types.ts';
import { encodeState, decodeState, mapData, hashState } from '../src/sim/snapshot.ts';
import { normalizeCommand, submitLocal } from '../src/sim/commands.ts';
import { shortestPath } from '../src/sim/map.ts';
import { advanceAuthority, applyFrame } from '../src/sim/lockstep.ts';

function fixture() {
  const w = createWorld({ seed: 4521, count: 40, enemies: 2, difficulty: 'normal', multiplayer: true });
  w.factions.forEach(f => { f.ai = false; f.gold = 1000; });
  w.provinces.forEach(p => { p.owner = 0; p.building = null; p.troops = []; p.mobile = []; });
  const p = w.provinces.find(p => !w.factions.some(f => f.hq === p.id)); return { w, p };
}
const work = (w, ticks = 120) => { for (let i = 0; i < ticks; i++) stepBuildingWork(w); };
function capture(w, p, owner = 1) {
  p.hp = 0; p.lastHit = w.time;
  const b = addBattle(w, p.id, [soldier(w, owner)]); reinforce(w, b);
  const invader = b.fighters.find(s => s.owner === owner); invader.x = FORT.x; invader.y = FORT.y;
  stepWorld(w); assert.equal(p.owner, owner);
}

test('construction takes four seconds, charges once and produces only when complete', () => {
  const { w, p } = fixture(); assert.equal(submitLocal(w, 0, { type: 'build', province: p.id, building: 'mine' }), null);
  assert.equal(w.factions[0].gold, 840); assert.ok(build(w, p.id, 'mine')); assert.equal(w.factions[0].gold, 840);
  for (let i = 0; i < 119; i++) stepWorld(w);
  assert.equal(w.factions[0].gold, 840); assert.ok(p.work);
  stepWorld(w); assert.equal(p.work, undefined); assert.equal(w.factions[0].gold, 840);
  stepWorld(w); assert.ok(w.factions[0].gold > 840);
});

test('manual construction cancellation refunds once, clears its routes and replays after recovery', () => {
  const { w, p } = fixture(); build(w, p.id, 'launcherWorks'); work(w, 100);
  const home = w.provinces[p.neighbors[0]]; home.building = 'barracks'; connect(w, p.id, home.id);
  p.troops = [soldier(w, 0)]; const unit = p.troops[0].id;
  assert.equal(normalizeCommand(w, 1, { type: 'cancelBuild', province: p.id }), null);
  const copy = decodeState(encodeState(w), mapData(w));
  const { frame, results } = advanceAuthority(w, [{ player: 0, seq: 1, command: { type: 'cancelBuild', province: p.id } }]); applyFrame(copy, frame);
  assert.equal(results[0].error, null); assert.equal(hashState(w), hashState(copy));
  assert.equal(p.building, null); assert.equal(p.work, undefined); assert.equal(w.routes.length, 0);
  assert.equal(p.troops[0].id, unit); assert.equal(w.factions[0].gold, 1000);
  assert.ok(submitLocal(w, 0, { type: 'cancelBuild', province: p.id })); assert.equal(w.factions[0].gold, 1000);
  w.settings.training = true; build(w, p.id, 'mine'); submitLocal(w, 0, { type: 'cancelBuild', province: p.id }); assert.equal(w.factions[0].gold, 1000);
});

test('manual demolition cancellation keeps the building and research without granting a salvage payment', () => {
  const { w, p } = fixture(); p.building = 'researchLab'; p.research = { id: 'blast1', elapsed: 10 };
  demolish(w, p.id); work(w, 110); p.mobile = [soldier(w, 1)];
  assert.ok(buildingWorkPaused(w, p));
  assert.equal(normalizeCommand(w, 1, { type: 'cancelDemolish', province: p.id }), null);
  assert.equal(submitLocal(w, 0, { type: 'cancelDemolish', province: p.id }), null);
  assert.equal(p.work, undefined); assert.equal(p.building, 'researchLab'); assert.equal(p.research.elapsed, 10); assert.equal(w.factions[0].gold, 1000);
  assert.ok(submitLocal(w, 0, { type: 'cancelDemolish', province: p.id })); assert.equal(w.factions[0].gold, 1000);
});

test('only enemies inside the province pause construction or demolition; artillery never pauses them', () => {
  for (const type of ['build', 'demolish']) {
    const { w, p } = fixture();
    if (type === 'build') build(w, p.id, 'barracks'); else { p.building = 'barracks'; demolish(w, p.id); }
    work(w, 30); const progress = p.work.elapsed;
    hurtBuilding(w, p.id, 1, 50); work(w, 30); assert.ok(p.work.elapsed > progress);
    const pausedAt = p.work.elapsed; p.mobile = [soldier(w, 1)]; assert.ok(buildingWorkPaused(w, p));
    work(w, 120); assert.equal(p.work.elapsed, pausedAt);
    p.mobile = []; work(w, 59); assert.ok(p.work); work(w, 1); assert.equal(p.work, undefined);
    assert.equal(p.building, type === 'build' ? 'barracks' : null);
  }
});

test('capturing a construction site cancels it and refunds the original payer in full', () => {
  const { w, p } = fixture(); build(w, p.id, 'armorWorks'); work(w, 60);
  assert.equal(w.factions[0].gold, 840); capture(w, p);
  assert.equal(p.building, null); assert.equal(p.work, undefined); assert.equal(w.factions[0].gold, 1000); assert.equal(w.factions[1].gold, 1000);
});

test('demolition refunds half the original build price, removes routes, and cannot demolish HQs', () => {
  const { w, p } = fixture(); p.building = 'launcherWorks'; p.level = 5;
  const home = w.provinces[p.neighbors[0]]; home.building = 'barracks'; connect(w, p.id, home.id);
  assert.equal(demolish(w, p.id), null); work(w, 119); assert.equal(w.factions[0].gold, 1000); assert.ok(p.building);
  work(w, 1); assert.equal(w.factions[0].gold, 1055); assert.equal(p.building, null); assert.equal(w.routes.length, 0); assert.equal(p.level, 1);
  home.building = 'hq'; assert.ok(demolish(w, home.id)); assert.equal(home.work, undefined);
});

test('capturing a demolition site removes it and gives the half-price refund to the captor', () => {
  const { w, p } = fixture(); p.building = 'armorWorks'; demolish(w, p.id); work(w, 45); capture(w, p);
  assert.equal(p.building, null); assert.equal(p.work, undefined); assert.equal(w.factions[0].gold, 1000); assert.equal(w.factions[1].gold, 1080);
});

test('upgrades keep their progress during combat and capture, and cancellation refunds their original payment', () => {
  const { w, p } = fixture(); p.building = 'barracks'; assert.equal(upgrade(w, p.id), null); assert.equal(w.factions[0].gold, 900);
  p.mobile = [soldier(w, 1)]; assert.equal(buildingWorkPaused(w, p), false); work(w, 45); assert.ok(p.work.elapsed > 1);
  p.mobile = []; const elapsed = p.work.elapsed; capture(w, p); assert.ok(p.work.elapsed > elapsed); assert.equal(p.level, 1);
  work(w, 74); assert.equal(p.level, 2); assert.equal(p.work, undefined);
  assert.equal(upgrade(w, p.id, 1), null); assert.equal(w.factions[1].gold, 800); work(w, 30);
  assert.equal(cancelUpgrade(w, p.id, 1), null); assert.equal(w.factions[1].gold, 1000); assert.equal(p.level, 2); assert.ok(cancelUpgrade(w, p.id, 1));
  p.owner = 0; upgrade(w, p.id, 0); p.owner = 1; cancelUpgrade(w, p.id, 1); assert.equal(w.factions[0].gold, 900); assert.equal(w.factions[1].gold, 1000);
});

test('defeat transfers the headquarters and instantly scraps every other losing building without refunds', () => {
  const { w, p } = fixture(), hq = w.provinces[w.factions[1].hq]; hq.owner = 1; hq.building = 'hq';
  p.owner = 1; p.building = 'barracks'; p.level = 3; upgrade(w, p.id, 1);
  const mine = w.provinces.find(q => q.id !== hq.id && q.id !== p.id); mine.owner = 1; mine.building = 'mine'; mine.hp = 0; mine.lastHit = w.time;
  const gold = w.factions[1].gold; capture(w, hq, 0);
  assert.equal(w.factions[1].alive, false); assert.equal(hq.building, 'hq'); assert.equal(hq.owner, 0);
  for (const q of [p, mine]) { assert.equal(q.owner, -1); assert.equal(q.building, null); assert.equal(q.work, undefined); }
  assert.equal(w.factions[1].gold, gold); assert.equal(w.winner, null);
  capture(w, hq, 2); assert.equal(w.factions[0].alive, true); assert.equal(hq.owner, 2);
});

test('new building commands enforce ownership and unfinished work survives snapshot replay', () => {
  const { w, p } = fixture(); build(w, p.id, 'barracks'); work(w, 30);
  for (const type of ['demolish', 'cancelUpgrade']) assert.equal(normalizeCommand(w, 1, { type, province: p.id }), null);
  const copy = decodeState(encodeState(w), mapData(w));
  for (let i = 0; i < 180; i++) { stepWorld(w); stepWorld(copy); }
  assert.equal(hashState(w), hashState(copy)); assert.equal(copy.provinces[p.id].work, undefined);
});

test('small, medium and large maps grant two, four and six extra connected provinces per faction', () => {
  for (const [count, extra] of [[40, 2], [60, 4], [80, 6]]) for (const seed of [4521, 42, 17]) {
    const w = createWorld({ count, seed, enemies: 5, difficulty: 'normal' }); assert.equal(startingLandBonus(count), extra);
    for (const f of w.factions) {
      const land = w.provinces.filter(p => p.owner === f.id); assert.equal(land.length, extra + 2);
      assert.equal(land.filter(p => !p.building).length, extra);
      assert.ok(land.every(p => shortestPath(w.provinces, f.hq, p.id, f.id).length > 0));
    }
  }
});
