import test from 'node:test';
import assert from 'node:assert/strict';
import { canFight, EFFECTS, WEAPONS } from '../src/content/equipment.ts';
import { createWorld, soldier, stepWorld, bombard, orderUnits, trainingBattle } from '../src/sim/world.ts';
import { addBattle, reinforce, stepBattle } from '../src/sim/combat.ts';
import { artilleryError, fireAttack, hurtBuilding, stepArtillery, stepAttacks, resolveDeaths } from '../src/sim/attacks.ts';
import { distance } from '../src/sim/map.ts';
import { fortPosition, toWorld } from '../src/sim/spatial.ts';
import { FORT } from '../src/sim/types.ts';

function quiet() {
  const w = createWorld({ seed: 4521, count: 12, enemies: 1, difficulty: 'normal' });
  w.factions.forEach(f => f.ai = false);
  w.provinces.forEach(p => { p.owner = 0; p.building = null; p.troops = []; p.mobile = []; });
  return w;
}
const shots = (w, seconds) => { for (let i = 0; i < seconds * 30; i++) { w.tick++; w.time = w.tick / 30; stepAttacks(w); } };
const advance = (w, seconds) => { for (let i = 0; i < seconds * 30; i++) stepWorld(w); };
function range(effects = [], positions = [[10, 0]], ammo = 'round') {
  const w = quiet(), shooter = { ...soldier(w, 0, 'launcher', ammo), position: { x: 0, y: 0 }, effects };
  const enemies = positions.map(([x, y]) => ({ ...soldier(w, 1), hp: 1000, position: { x, y } }));
  w.provinces[0].troops = [shooter, ...enemies];
  fireAttack(w, shooter, shooter.position, enemies[0]?.position ?? { x: 30, y: 0 }, 0, enemies[0]?.id);
  return { w, shooter, enemies };
}
function artillery() {
  const w = quiet(), home = w.provinces[0], target = w.provinces.find(p => distance(p, home) > 110 && distance(p, home) < 250)!;
  target.owner = 1;
  const gun = { ...soldier(w, 0), position: { x: home.x, y: home.y }, effects: ['lob', 'blast'] };
  home.troops = [gun]; return { w, home, target, gun };
}

test('plain shots stop at the first enemy and pierce reaches three enemies with one blast on the first hit', () => {
  const plain = range([], [[8, 0], [14, 0], [20, 0]]); shots(plain.w, 1);
  assert.ok(plain.enemies[0].hp < 1000); assert.equal(plain.enemies[1].hp, 1000);
  const { w, enemies } = range(['pierce', 'blast'], [[8, 0], [14, 0], [20, 0]]);
  shots(w, .18); assert.ok(enemies[0].hp < 1000); assert.ok(w.visuals.some(v => v.kind === 'blast'));
  shots(w, .25); assert.ok(enemies.every(s => s.hp < 1000)); assert.equal(w.visuals.filter(v => v.kind === 'blast').length, 1);
});

test('projectiles never travel farther than their remaining lifetime', () => {
  const { w, enemies } = range([], [[10, 0]]); w.projectiles[0].life = .01;
  stepAttacks(w); assert.equal(enemies[0].hp, 1000); assert.equal(w.projectiles.length, 0);
});

test('a blast hits nearby soldiers and leaves soldiers outside its radius unharmed', () => {
  const { w, enemies } = range(['blast'], [[10, 0], [10, 3.24], [10, 9]]);
  shots(w, 1);
  assert.ok(enemies[0].hp < 1000); assert.ok(enemies[1].hp < 1000); assert.equal(enemies[2].hp, 1000);
});

test('split creates full independent branches at the first main trigger', () => {
  const plain = range(['split'], []); assert.equal(plain.w.projectiles.length, 1);
  shots(plain.w, .4); assert.equal(plain.w.projectiles.length, 3);
  assert.ok(plain.w.projectiles.every(p => p.damage === 50 && !p.triggered && p.leaf));
  shots(plain.w, 3); assert.equal(plain.w.projectiles.length, 0);
  const payload = range(['blast', 'split']); shots(payload.w, 4 / 30);
  assert.equal(payload.w.projectiles.length, 3); assert.ok(payload.w.projectiles.every(p => p.leaf && !p.effects.includes('split')));
  shots(payload.w, 3); assert.equal(payload.w.projectiles.length, 0);
});

test('electric split fires at contact and never damages allies', () => {
  const { w, shooter, enemies } = range(['arc', 'split'], [[9, 0], [8, 3], [8, -3]]);
  const ally = { ...soldier(w, 0), position: { x: 7, y: 0 } }; w.provinces[0].troops.push(ally);
  assert.equal(w.projectiles.length, 1); stepAttacks(w); assert.equal(w.visuals.filter(v => v.kind === 'arc').length, 0);
  shots(w, 2 / 30); assert.equal(w.visuals.filter(v => v.kind === 'arc').length, 3);
  assert.ok(enemies.every(s => s.hp < 1000)); assert.equal(ally.hp, 200); assert.equal(shooter.hp, 200);
});

test('bounce turns toward another enemy and homing bends toward a moved target', () => {
  const bounce = range(['bounce'], [[10, 0], [10, 10]]); shots(bounce.w, .5);
  assert.ok(bounce.enemies.every(s => s.hp < 1000)); shots(bounce.w, 3); assert.equal(bounce.w.projectiles.length, 0);
  const guided = range(['homing'], [[25, 0]]); guided.enemies[0].position.y = 7; shots(guided.w, .2);
  assert.ok(guided.w.projectiles[0].y > 0); assert.ok(guided.w.projectiles[0].vy > 0);
});

test('return travels back, linger holds its endpoint, and delayed detonation expires exactly once', () => {
  const returning = range(['return'], []); shots(returning.w, .5);
  assert.equal(returning.w.projectiles[0].returning, true); const x = returning.w.projectiles[0].x;
  shots(returning.w, .1); assert.ok(returning.w.projectiles[0].x < x); shots(returning.w, 3); assert.equal(returning.w.projectiles.length, 0);
  const { w } = range(['linger', 'blast', 'delay']); shots(w, .3);
  assert.equal(w.projectiles[0].phase, 'linger'); const point = { x: w.projectiles[0].x, y: w.projectiles[0].y };
  shots(w, .7); assert.deepEqual({ x: w.projectiles[0].x, y: w.projectiles[0].y }, point); assert.ok(w.visuals.some(v => v.kind === 'blast'));
  shots(w, 2); assert.equal(w.projectiles.length, 0); shots(w, 3); assert.equal(w.visuals.length, 0);
});

test('burn and frost apply battlefield effects, and trail leaves separate points along the path', () => {
  const burn = range(['burn']); shots(burn.w, .2); assert.ok(burn.w.fields.some(f => f.kind === 'burn'));
  const before = burn.enemies[0].hp; shots(burn.w, 1); assert.ok(burn.enemies[0].hp < before);
  const cold = range(['frost']); shots(cold.w, .3); assert.ok(cold.enemies[0].chill > 0 || cold.enemies[0].frozen > 0);
  for (let i = 0; i < 3; i++) { fireAttack(cold.w, cold.shooter, cold.shooter.position, cold.enemies[0].position, 0); shots(cold.w, .3); }
  shots(cold.w, 1); assert.ok(cold.enemies[0].frozen > 0);
  const trail = range(['burn', 'trail'], []); shots(trail.w, .6);
  assert.ok(trail.w.fields.length >= 3); assert.ok(new Set(trail.w.fields.map(f => Math.floor(f.x))).size >= 3);
});

test('melee pierce deals full direct hits with one area payload trigger per swing', () => {
  for (const pierce of [false, true]) {
    const w = quiet(), p = w.provinces[0], b = addBattle(w, p.id, []);
    const fighter = (owner, x, y, weapon) => ({ ...soldier(w, owner, weapon), x, y, angle: 0, cooldown: owner ? 1000 : 0, recoil: 0, suppressed: 0, hp: 1000 });
    const attacker = fighter(0, 100, 100, 'hilt'); attacker.effects = ['blast', ...(pierce ? ['pierce'] : [])];
    const enemies = [fighter(1, 130, 100, 'launcher'), fighter(1, 130, 110, 'launcher'), fighter(1, 130, 90, 'launcher')];
    b.fighters = [attacker, ...enemies]; stepBattle(w, b);
    assert.equal(enemies[0].hp, 910); assert.equal(enemies[1].hp, pierce ? 910 : 960); assert.equal(enemies[2].hp, pierce ? 910 : 960);
    assert.equal(w.fields.length, 0); assert.equal(w.projectiles.length, 0); assert.equal(w.visuals.filter(v => v.kind === 'blast').length, 1);
  }
});

test('artillery requires lob and respects both minimum distance and close combat suppression', () => {
  const { w, home, target, gun } = artillery(); gun.effects = [];
  assert.match(bombard(w, [gun.id], target.id), /抛射/); gun.effects = ['lob', 'blast'];
  assert.match(artilleryError(w, gun, { x: gun.position.x + 10, y: gun.position.y }), /最小/);
  assert.match(artilleryError(w, gun, { x: gun.position.x + 400, y: gun.position.y }), /射程/);
  assert.equal(bombard(w, [gun.id], target.id), null);
  const enemy = { ...soldier(w, 1), position: { x: home.x + 5, y: home.y } }; home.troops.push(enemy);
  stepArtillery(w); assert.equal(w.projectiles.length, 0); assert.match(artilleryError(w, gun, target), /压制/);
  const b = addBattle(w, home.id, []); b.reserve.forEach(s => s.deployAt = 0); reinforce(w, b);
  const g = b.fighters.find(s => s.id === gun.id)!; g.cooldown = 0; b.fighters.find(s => s.id === enemy.id)!.cooldown = 1000;
  stepBattle(w, b); stepArtillery(w); assert.equal(w.projectiles.length, 0); assert.equal(g.recoil, 0);
  assert.ok(canFight(g));
});

test('launched artillery survives its source and hits garrison, reserves, unarmed and marching enemies', () => {
  const { w, home, target, gun } = artillery(), point = { x: target.x, y: target.y };
  const enemy = () => ({ ...soldier(w, 1), hp: 1000, position: { ...point } });
  const garrison = enemy(), mobile = enemy(), naked = { ...enemy(), weapon: null, ammo: null, recruit: true }, reserve = enemy(), marching = enemy(), friend = { ...enemy(), owner: 0 };
  target.troops = [garrison, naked, friend]; target.mobile = [mobile];
  w.battles.push({ province: target.id, fighters: [], reserve: [reserve], nextDeploy: [], models: true, shots: 0, losses: [0, 0] });
  w.shipments.push({ id: w.nextId++, owner: 1, from: target.id, to: home.id, path: [target.id, home.id], leg: 0, ...point, troops: [marching] });
  assert.equal(bombard(w, [gun.id], target.id, point), null); stepArtillery(w); assert.equal(w.projectiles.length, 1);
  home.troops = []; home.owner = 1; shots(w, 5);
  assert.ok([garrison, mobile, naked, reserve, marching].every(s => s.hp < 1000)); assert.equal(friend.hp, 1000);
  assert.equal(target.owner, 1); assert.equal(w.projectiles.length, 0);
});

test('ordinary projectiles cannot hit another province even when its units are within their physical range', () => {
  const { w, enemies } = range([], [[10, 0]]);
  w.provinces[0].troops = w.provinces[0].troops.filter(s => s.owner === 0); w.provinces[1].troops = enemies;
  shots(w, 1); assert.equal(enemies[0].hp, 1000);
});

test('bombardment disables production without capture, then repairs or yields to an occupying ground unit', () => {
  const { w, target } = artillery(); target.building = 'mine'; target.hp = 1;
  const gold = w.factions[1].gold; hurtBuilding(w, target.id, 0, 10); advance(w, 7);
  assert.equal(target.hp, 0); assert.equal(target.owner, 1); assert.equal(w.factions[1].gold, gold); assert.equal(w.factions[1].alive, true);
  advance(w, 2); assert.ok(target.hp > 0); assert.ok(w.factions[1].gold > gold);
  hurtBuilding(w, target.id, 0, 1000);
  const b = addBattle(w, target.id, [soldier(w, 0)]); reinforce(w, b);
  b.fighters[0].x = FORT.x - 20; b.fighters[0].y = FORT.y; stepWorld(w);
  assert.equal(target.owner, 0); assert.equal(target.hp, 3000);
});

test('moving artillery to allied land cancels its order, and training creates a usable firing position', () => {
  const { w, home, target, gun } = artillery(); bombard(w, [gun.id], target.id);
  const destination = home.neighbors.find(id => w.provinces[id].owner === 0)!;
  assert.equal(orderUnits(w, [gun.id], destination), null); stepArtillery(w); assert.equal(w.projectiles.length, 0);
  const id = trainingBattle(w, { weapon: 'launcher', ammo: 'round', effects: ['lob', 'blast'] }, 4);
  stepArtillery(w); assert.equal(w.projectiles.length, 4); assert.ok(w.projectiles.every(p => distance(p.origin, p.aim) >= 65));
  assert.equal(w.provinces[id].owner, 1);
});

test('each accessory lifecycle terminates without creating recursive projectiles', () => {
  for (const effect of Object.keys(EFFECTS).filter(e => e !== 'lob')) {
    const extras = ['trail', 'delay'].includes(effect) ? ['blast'] : [];
    const { w } = range([effect, ...extras], [[10, 0], [14, 3]], 'round');
    shots(w, 15); assert.equal(w.projectiles.length, 0, effect); assert.equal(w.fields.length, 0, effect);
  }
});

test('full ranged combinations expire for entity ammunition', () => {
  for (const ammo of ['round']) {
    const { w } = range(Object.keys(EFFECTS).filter(e => !['lob', 'arc', 'burn', 'frost'].includes(e)), [[10, 0], [15, 4]], ammo);
    shots(w, 20); assert.equal(w.projectiles.length, 0, ammo); assert.equal(w.fields.length, 0, ammo);
  }
  const { w, gun, target } = artillery(); gun.effects = Object.keys(EFFECTS).filter(e => !['arc', 'burn', 'frost'].includes(e));
  fireAttack(w, gun, gun.position, target, null); shots(w, 25);
  assert.equal(w.projectiles.length, 0); assert.equal(w.fields.length, 0);
});

test('artillery can defend allied land and keeps fighting when its own building is disabled', () => {
  const { w, home, target, gun } = artillery(); target.owner = 0; home.hp = 0;
  const enemy = { ...soldier(w, 1), position: { x: target.x, y: target.y } }; target.troops = [enemy];
  assert.equal(bombard(w, [gun.id], target.id, enemy.position), null); stepArtillery(w);
  assert.equal(w.projectiles.length, 1); shots(w, 5); assert.ok(enemy.hp < 200);
});
