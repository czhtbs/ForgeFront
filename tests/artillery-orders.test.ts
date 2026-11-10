import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, soldier, orderUnits, stepWorld, allTroops } from '../src/sim/world.ts';
import { stepArtillery, stepAttacks, fireAttack } from '../src/sim/attacks.ts';
import { distance, inside, mapBounds } from '../src/sim/map.ts';
import { troopCenter, toBattle } from '../src/sim/spatial.ts';
import { ARTILLERY_MAX, ARTILLERY_MIN, LAUNCHERS } from '../src/content/equipment.ts';
const quiet = (count = 40) => {
  const w = createWorld({ seed: 4521, count, enemies: 1, difficulty: 'normal' });
  w.factions.forEach(f => { f.ai = false; });
  w.provinces.forEach(p => { p.owner = 0; p.building = null; p.troops = []; p.mobile = []; }); return w;
};
const gun = (w, position) => ({ ...soldier(w, 0), position: { ...position }, effects: ['lob', 'blast'] });

test('only rifle and sword remain in the production catalog', () => {
  assert.deepEqual(Object.keys(LAUNCHERS), ['rifle', 'sword']);
});

test('an ordinary arrow orders artillery to deploy in place and a move cancels its fire order', () => {
  const w = quiet(), source = w.provinces[0], target = w.provinces.find(p => distance(p, source) > 140 && distance(p, source) < 250);
  target.owner = 1; source.troops = Array.from({ length: 4 }, (_, i) => gun(w, { x: source.x + i, y: source.y + 18 }));
  const ids = source.troops.map(s => s.id); assert.equal(orderUnits(w, ids, target.id), null);
  assert.ok(source.troops.every(s => s.bombard)); assert.equal(w.shipments.length, 0);
  for (let i = 0; i < 60; i++) stepWorld(w);
  assert.ok(w.projectiles.length); assert.equal(w.shipments.length, 0); assert.equal(source.troops.length, 4);
  assert.ok(source.troops.every(s => distance(s.position, source.troops[0].bombard.center) < 10));
  assert.equal(orderUnits(w, ids, source.neighbors[0]), null); assert.ok(allTroops(w).filter(s => ids.includes(s.id)).every(s => !s.bombard));
});

test('out-of-range artillery approaches, stops at its group firing radius and preserves every soldier', () => {
  const w = quiet(), source = w.provinces[0], target = [...w.provinces].sort((a, b) => distance(b, source) - distance(a, source))[0];
  assert.ok(distance(source, target) > ARTILLERY_MAX + 80); target.owner = 1;
  source.troops = Array.from({ length: 3 }, (_, i) => gun(w, { x: source.x + i * 3, y: source.y })); const ids = source.troops.map(s => s.id);
  assert.equal(orderUnits(w, ids, target.id), null); stepWorld(w); assert.equal(w.shipments.length, 1);
  for (let i = 0; i < 3000 && !w.projectiles.length; i++) stepWorld(w);
  assert.ok(w.projectiles.length); assert.equal(w.shipments.length, 0);
  const troops = allTroops(w).filter(s => ids.includes(s.id)), center = troopCenter(troops);
  assert.equal(troops.length, 3); assert.equal(new Set(troops.map(s => s.id)).size, 3);
  assert.ok(distance(center, target) <= ARTILLERY_MAX + 1); assert.ok(distance(center, target) >= ARTILLERY_MIN);
  assert.ok(!w.battles.some(b => b.province === target.id));
});

test('artillery retargets a marching unit before each shot and damages it while it moves', () => {
  const w = quiet(), source = w.provinces[0], bounds = mapBounds(w.provinces), angle = Math.atan2(bounds.y - source.y, bounds.x - source.x);
  const point = { x: source.x + Math.cos(angle) * 72, y: source.y + Math.sin(angle) * 72 }, target = w.provinces.find(p => inside(point, p.polygon));
  const shooter = gun(w, source), enemy = { ...soldier(w, 1), hp: 1000, position: point }; source.troops = [shooter];
  w.shipments.push({ id: w.nextId++, owner: 1, from: target.id, to: source.id, path: [target.id, source.id], leg: 0, ...point, troops: [enemy] });
  assert.equal(orderUnits(w, [shooter.id], target.id, 0, point, [enemy.id]), null);
  for (let i = 0; i < 80; i++) {
    enemy.position.x -= Math.sin(angle) * .4; enemy.position.y += Math.cos(angle) * .4;
    stepArtillery(w);
    if (i === 0) assert.deepEqual(w.projectiles[0].aim, enemy.position);
    stepAttacks(w);
  }
  assert.ok(enemy.hp < 1000); assert.equal(shooter.hp, 100);
});

test('artillery uses a fighting targets current world coordinates and reacquires surviving group members', () => {
  const w = quiet(), source = w.provinces[0], target = w.provinces.find(p => distance(p, source) > 120 && distance(p, source) < 240);
  const shooter = gun(w, source); source.troops = [shooter]; target.owner = 1;
  const enemies = [0, 1].map(i => ({ ...soldier(w, 1), hp: 1000, ...toBattle(target, { x: target.x + i * 5, y: target.y }), position: { x: 0, y: 0 }, angle: 0, cooldown: 100, recoil: 0, suppressed: 0 }));
  w.battles.push({ province: target.id, fighters: enemies, reserve: [], wave: 0, nextDeploy: [], models: true, shots: 0, losses: [0, 0] });
  assert.equal(orderUnits(w, [shooter.id], target.id, 0, target, enemies.map(s => s.id)), null);
  enemies[0].x += 100; stepArtillery(w); assert.ok(w.projectiles[0].aim.x > target.x + 10);
  for (let i = 0; i < 150; i++) stepAttacks(w);
  assert.ok(enemies[0].hp < 1000);
  enemies[0].hp = 0; shooter.artilleryCooldown = 0; stepArtillery(w); assert.equal(w.projectiles[0].target, enemies[1].id);
});

test('artillery range is checked at the group center while back-row shells still reach the aim point', () => {
  const w = quiet(), source = w.provinces[0], shooter = gun(w, source), point = { x: source.x + 345, y: source.y };
  fireAttack(w, shooter, shooter.position, point, source.id);
  assert.equal(w.projectiles[0].province, null); assert.ok(w.projectiles[0].life * 75 >= 345);
  for (let i = 0; i < 140; i++) stepAttacks(w);
  assert.ok(w.visuals.some(v => v.kind === 'blast' && Math.abs(v.x - point.x) < .01));
});

test('an in-range attack interrupts a gun march without moving or losing the rest of the column', () => {
  const w = quiet(), source = w.provinces[0], next = w.provinces[source.neighbors[0]], target = w.provinces.find(p => distance(p, source) > 140 && distance(p, source) < 250);
  target.owner = 1; source.troops = [gun(w, source), gun(w, { x: source.x + 3, y: source.y })]; const ids = source.troops.map(s => s.id);
  assert.equal(orderUnits(w, ids, next.id), null); assert.equal(w.shipments.length, 1);
  assert.equal(orderUnits(w, [ids[0]], target.id), null); stepWorld(w);
  assert.equal(w.shipments.length, 1); assert.deepEqual(w.shipments[0].troops.map(s => s.id), [ids[1]]);
  assert.ok(w.provinces.some(p => [...p.troops, ...p.mobile].some(s => s.id === ids[0] && s.bombard)));
  assert.equal(allTroops(w).filter(s => ids.includes(s.id)).length, 2);
});
