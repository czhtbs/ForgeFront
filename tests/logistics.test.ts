import test from 'node:test';
import assert from 'node:assert/strict';
import { canFight, workshopFor } from '../src/content/equipment.ts';
import { createWorld, soldier, stepWorld, connect, disconnect, reroute, configuredItems, productionState, setFactoryOutput, allTroops, localTroops, dispatch } from '../src/sim/world.ts';
import { supplyLanes, routeGeometry } from '../src/render/geometry.ts';

const advance = (w, seconds) => { for (let i = 0; i < seconds * 30; i++) stepWorld(w); };
function setup() {
  const w = createWorld({ seed: 4521, count: 12, enemies: 1, difficulty: 'normal' });
  w.factions.forEach(f => f.ai = false);
  w.provinces.forEach(p => { p.owner = 0; p.building = null; p.troops = []; p.mobile = []; });
  return w;
}
function home(w, id, count = 0) {
  const p = w.provinces[id]; p.building = 'barracks';
  p.troops = Array.from({ length: count }, () => ({ ...soldier(w, 0), weapon: null, ammo: null, recruit: true }));
  return p;
}
function factory(w, id, item) {
  const p = w.provinces[id]; p.building = workshopFor(item); p.output = item; p.level = 4;
  return p;
}
const link = (w, from, to) => { assert.equal(connect(w, from, to), null); return w.routes.at(-1)!; };

test('relay stops local assembly and forwards all incoming equipment along the single recruit line', () => {
  const w = setup(), a = home(w, 0, 6), b = home(w, 1);
  const ids = a.troops.map(s => s.id), armed = { ...soldier(w, 0), recruit: true }; a.troops.push(armed);
  a.troops[0].effects = ['pierce'];
  factory(w, 2, 'rifle'); factory(w, 3, 'burn');
  link(w, 2, a.id); link(w, 3, a.id); const relay = link(w, a.id, b.id);
  assert.deepEqual(configuredItems(w, b.id).sort(), ['burn', 'rifle']);
  stepWorld(w);
  const moving = w.shipments.find(s => s.transferRoute === relay.id)!;
  assert.deepEqual(moving.troops.map(s => s.id).sort(), [...ids].sort());
  assert.ok(moving.troops.every(s => s.recruit && !s.weapon));
  assert.match(productionState(w, a.id).status, /停止本地装配/);
  advance(w, 50);
  const arrivals = localTroops(w, b.id).filter(s => ids.includes(s.id));
  assert.equal(arrivals.length, ids.length);
  assert.ok(arrivals.every(s => s.recruit && canFight(s) && s.effects.includes('burn')));
  assert.ok(arrivals.find(s => s.id === ids[0])!.effects.includes('pierce'));
  assert.ok(a.troops.includes(armed)); assert.deepEqual(armed.effects, []);
  assert.equal(productionState(w, b.id).inputs.rifle, 1);
  assert.equal(productionState(w, b.id).inputs.burn, 4 / 6);
  assert.equal(w.routes.length, 3);
  assert.equal(supplyLanes(w, a.id, 1).filter(l => l.r.from === a.id && l.r.to === b.id).length, 1);
  assert.equal(new Set(allTroops(w).map(s => s.id)).size, allTroops(w).length);
});

test('recruits split evenly, blocked shares stay home, and incoming reservations prevent overfilling', () => {
  const w = setup(), a = home(w, 0, 10), b = home(w, 1), c = home(w, 2), other = home(w, 3, 4);
  b.troops = Array.from({ length: 59 }, () => soldier(w, 0));
  const ids = a.troops.map(s => s.id), blocked = other.troops.map(s => s.id);
  link(w, a.id, b.id); link(w, a.id, c.id); link(w, other.id, b.id);
  stepWorld(w);
  assert.equal(w.shipments.filter(s => s.to === b.id).flatMap(s => s.troops).length, 1);
  assert.equal(w.shipments.filter(s => s.to === c.id).flatMap(s => s.troops).length, 5);
  assert.equal(a.troops.filter(s => ids.includes(s.id)).length, 4);
  advance(w, 40);
  assert.equal(localTroops(w, b.id).length, 60);
  assert.equal(a.troops.filter(s => ids.includes(s.id)).length, 4);
  assert.equal(other.troops.filter(s => blocked.includes(s.id)).length, 4);
  b.troops.splice(0, 5); advance(w, 1);
  assert.ok(w.shipments.some(s => s.to === b.id && s.troops.some(t => ids.includes(t.id))));
});

test('multi-hop splitting conserves supply rates and rejects cycles and downstream conflicts atomically', () => {
  const w = setup(); factory(w, 0, 'rifle'); factory(w, 1, 'burn');
  for (const id of [2, 3, 4, 5]) home(w, id);
  link(w, 0, 2); link(w, 1, 2); link(w, 2, 3); link(w, 2, 4); link(w, 3, 5);
  const before = w.routes.length;
  assert.match(connect(w, 5, 2)!, /循环/); assert.match(connect(w, 2, 2)!, /循环/);
  factory(w, 6, 'sword'); assert.ok(connect(w, 6, 5));
  factory(w, 7, 'lob'); link(w, 7, 5);
  assert.ok(setFactoryOutput(w, 0, 'sword')); assert.equal(w.provinces[0].output, 'rifle');
  assert.equal(w.routes.length, before + 1);
  advance(w, 90);
  for (const id of [4, 5]) {
    const state = productionState(w, id);
    assert.equal(state.inputs.rifle, .5); assert.equal(state.inputs.burn, 2 / 6);
  }
  assert.ok(localTroops(w, 5).some(canFight));
});

test('ordinary army reinforcements keep their existing rules and recruits wait if an army fills reserved space', () => {
  const w = setup(), a = home(w, 0, 1), b = home(w, 1), army = home(w, 2);
  army.troops = [soldier(w, 0)];
  assert.equal(dispatch(w, army.id, b.id), null);
  assert.equal(productionState(w, b.id).incoming, 0);
  const recruitId = a.troops[0].id;
  link(w, a.id, b.id); stepWorld(w);
  assert.equal(productionState(w, b.id).incoming, 1);
  b.troops = Array.from({ length: 60 }, () => soldier(w, 0));
  advance(w, 35);
  const waiting = w.shipments.find(s => s.troops.some(t => t.id === recruitId))!;
  assert.ok(waiting); assert.equal(waiting.leg, waiting.path.length - 1);
  assert.ok(!b.troops.some(s => s.id === recruitId));
  b.troops.splice(0, 2); stepWorld(w);
  assert.ok(localTroops(w, b.id).some(s => s.id === recruitId));
});

test('changing one recruit route changes subsequent equipment travel and disconnect restores assembly', () => {
  const w = setup(); factory(w, 0, 'rifle'); const a = home(w, 1, 2), b = home(w, 2);
  link(w, 0, a.id); const r = link(w, a.id, b.id), via = w.provinces[8];
  assert.equal(reroute(w, r.id, [{ x: via.x, y: via.y, province: via.id }]), null);
  assert.ok(routeGeometry(w, r).some(v => v.point.x === via.x && v.point.y === via.y));
  stepWorld(w); assert.deepEqual(w.shipments.find(s => s.transferRoute === r.id)!.path, r.path);
  advance(w, 25);
  const flows = w.flows.filter(f => f.from === a.id && f.to === b.id);
  assert.ok(flows.length);
  const latest = flows.at(-1)!;
  assert.equal(latest.start - (w.tick - (w.tick - 1) % 30), (r.path.length - 1) * 90);
  disconnect(w, r.id);
  assert.equal(productionState(w, a.id).forwarding, false);
  advance(w, 20);
  assert.ok(a.troops.some(canFight));
  assert.equal('stock' in a, false);
});

test('recruits already in transit survive a captured destination as unarmed captives, never combat fighters', () => {
  const w = setup(), a = home(w, 0, 3), b = home(w, 1), ids = a.troops.map(s => s.id);
  link(w, a.id, b.id); stepWorld(w); b.owner = 1;
  advance(w, 35);
  assert.ok(!w.routes.some(r => r.to === b.id));
  for (const id of ids) {
    const unit = localTroops(w, b.id).find(s => s.id === id)!;
    assert.ok(unit); assert.equal(unit.owner, 1); assert.equal(unit.recruit, true); assert.equal(canFight(unit), false);
  }
  assert.ok(w.battles.every(battle => [...battle.fighters, ...battle.reserve].every(canFight)));
  assert.equal(new Set(allTroops(w).map(s => s.id)).size, allTroops(w).length);
});

test('a cut branch keeps its recruit and equipment share instead of redirecting it to another destination', () => {
  const w = setup(), a = home(w, 0, 8), b = home(w, 1), c = home(w, 2);
  factory(w, 3, 'rifle'); link(w, 3, a.id); const blocked = link(w, a.id, b.id); link(w, a.id, c.id);
  b.hp = 0; b.lastHit = 1000;
  stepWorld(w);
  assert.equal(blocked.status, 'idle');
  assert.equal(a.troops.length, 4);
  assert.equal(w.shipments.flatMap(s => s.troops).length, 4);
  advance(w, 35);
  assert.equal(productionState(w, c.id).inputs.rifle, .5);
  assert.equal(productionState(w, b.id).inputs.rifle, undefined);
});
