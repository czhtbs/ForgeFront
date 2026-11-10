import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, connect, reroute, soldier, stepWorld } from '../src/sim/world.ts';
import { stepAttacks, resolveDeaths } from '../src/sim/attacks.ts';
import { addBattle, reinforce, stepBattle, fortAim, SPLASH_RADIUS } from '../src/sim/combat.ts';
import { battleFrame, BATTLE_SPACING, buildingWidth, fortPosition } from '../src/sim/spatial.ts';
import { FORT } from '../src/sim/types.ts';
import { lineLength, pointAlong, supplyLanes, commandRibbon, attackDestination } from '../src/render/geometry.ts';
import { deathFragments, swordPose, portraitFrame, ARMY_PORTRAITS } from '../src/render/art.ts';
import { elevation } from '../src/render/terrain.ts';
import { BUILDING_HITS } from '../src/content/building-hits.ts';
const make = () => { const w = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal' }); w.factions.forEach(f => f.ai = false); return w; };

test('sword swings around the hand and its army portrait uses artwork instead of a text overlay', () => {
  const w = make(), unit = { ...soldier(w, 0, 'hilt'), position: { x: 30, y: 40 }, angle: 0 };
  const poses = [1, .8, .3, 0].map(recoil => swordPose(unit, recoil));
  assert.ok(poses.every(p => Math.abs(Math.hypot(p.tip.x - p.grip.x, p.tip.y - p.grip.y) - 3) < 1e-9));
  assert.deepEqual(poses[0].grip, poses[1].grip); assert.ok(Math.hypot(poses[1].tip.x - poses[2].tip.x, poses[1].tip.y - poses[2].tip.y) > 4);
  assert.deepEqual(poses[0], poses[3]); assert.equal(ARMY_PORTRAITS[portraitFrame(unit)], 'sword');
});

test('melee attacks damage buildings without ranged yellow hit marks and retain a visible swing', () => {
  const w = make(), p = w.provinces.find(p => p.owner === -1)!; p.building = 'launcherWorks';
  const b = addBattle(w, p.id, [soldier(w, 0, 'hilt')]); reinforce(w, b);
  const fighter = b.fighters[0]; fighter.x = FORT.x - FORT.radius - 35; fighter.y = FORT.y; fighter.angle = 0; fighter.cooldown = 0;
  const hp = p.hp; stepBattle(w, b);
  assert.equal(p.hp, hp - 28); assert.equal(fighter.recoil, 1); assert.equal(w.projectiles.length, 0);
  assert.ok(!w.visuals.some(v => v.kind === 'fort-hit'));
  for (let i = 0; i < 6; i++) stepBattle(w, b); assert.ok(fighter.recoil > 0);
  for (let i = 0; i < 3; i++) stepBattle(w, b); assert.equal(fighter.recoil, 0); assert.equal(p.hp, hp - 28);
});

test('ground relief is deterministic, varied and continuous across arbitrary province borders', () => {
  const values = Array.from({ length: 80 }, (_, i) => elevation(i * 11, i * 6, 4521));
  assert.deepEqual(values, Array.from({ length: 80 }, (_, i) => elevation(i * 11, i * 6, 4521)));
  assert.ok(Math.max(...values) - Math.min(...values) > .2);
  assert.ok(Math.abs(elevation(300, 400, 4521) - elevation(300.001, 400, 4521)) < .001);
});

test('one travelling point crosses joints continuously and is unaffected by subdivision', () => {
  const a = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const b = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 70, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 100 }];
  assert.equal(lineLength(a), lineLength(b));
  for (const d of [0, 29, 70, 99.9, 100, 100.1, 170, 200]) { const p = pointAlong(a, d), q = pointAlong(b, d); assert.ok(Math.hypot(p.x - q.x, p.y - q.y) < 1e-9); }
  assert.ok(Math.hypot(pointAlong(a, 99.9).x - pointAlong(a, 100.1).x, pointAlong(a, 99.9).y - pointAlong(a, 100.1).y) < .15);
});

test('overlapping supply routes get separate lanes while both ends remain on buildings', () => {
  const w = make(); w.provinces.forEach(p => { p.owner = 0; p.building = 'barracks'; });
  const source = w.provinces[0], junction = w.provinces[source.neighbors[0]], targets = junction.neighbors.filter(n => n !== source.id).slice(0, 2); source.building = 'launcherWorks';
  for (const id of targets) { assert.equal(connect(w, source.id, id), null); reroute(w, w.routes.at(-1)!.id, [{ x: junction.x, y: junction.y, province: junction.id }]); }
  const lanes = supplyLanes(w, source.id, 1);
  assert.equal(lanes.length, 2);
  for (const line of lanes) {
    assert.deepEqual({ x: line.points[0].point.x, y: line.points[0].point.y }, fortPosition(source));
    assert.deepEqual({ x: line.points.at(-1)!.point.x, y: line.points.at(-1)!.point.y }, fortPosition(w.provinces[line.r.to]));
  }
  const a = lanes[0].points[1].point, b = lanes[1].points[1].point;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 14.9);
});

test('command arrow lifts from the ground and stays compact at different zoom levels', () => {
  const w = make(), p = w.provinces[0];
  for (const owner of [-1, 1]) { p.owner = owner; assert.equal(attackDestination(w, p.id, 0), true); }
  p.owner = 0; assert.equal(attackDestination(w, p.id, 0), false);
  addBattle(w, p.id, [soldier(w, 1)]); assert.equal(attackDestination(w, p.id, 0), true);
  for (const z of [1, 4]) {
    const ribbon = commandRibbon([{ x: 0, y: 100 }, { x: 200 / z, y: 100 }], z);
    assert.ok(ribbon.face.every(p => Number.isFinite(p.x + p.y)));
    assert.ok(Math.min(...ribbon.face.map(p => p.y)) < 100 - 15 / z);
    assert.ok(Math.min(...ribbon.face.map(p => p.y)) > 100 - 32 / z);
    assert.ok(ribbon.face.some(p => p.x === 200 / z && p.y === 100));
  }
});

test('casualties persist beyond a completed battle, scatter real components, then expire', () => {
  const w = make(), p = w.provinces.find(p => p.owner === -1)!; p.owner = 0;
  const b = addBattle(w, p.id, [soldier(w, 0), soldier(w, 1, 'launcher')]); b.reserve.forEach(s => s.deployAt = 0); reinforce(w, b);
  const victim = b.fighters.find(f => f.owner === 1)!; victim.hp = 0; victim.killedBy = 0; victim.hitAngle = .4;
  stepWorld(w); assert.equal(w.casualties.length, 1); assert.ok(!w.battles.includes(b));
  const c = w.casualties[0], beginning = deathFragments(c, 0), thrown = deathFragments(c, .3), settled = deathFragments(c, 2);
  assert.deepEqual(thrown.map(p => p.frame), [0, 1, 2]); assert.ok(thrown.some((p, i) => Math.hypot(p.x - beginning[i].x, p.y - beginning[i].y) > 1));
  assert.ok(settled.every(p => p.alpha === 1)); assert.ok(deathFragments(c, 5).every(p => p.alpha === 0));
  for (let i = 0; i < 151; i++) stepWorld(w); assert.equal(w.casualties.length, 0);
});

test('combat separation opens a modest gap without exceeding the splash radius', () => {
  const w = make(), p = w.provinces.find(p => p.owner === -1)!, b = addBattle(w, p.id, []), scale = battleFrame(p).scale;
  const f = (id: number, x: number) => ({ ...soldier(w, id), x, y: 0, angle: 0, cooldown: 1000, recoil: 0, suppressed: 0 });
  b.fighters = [f(0, 200), f(0, 200), f(1, 1500)];
  for (let i = 0; i < 30; i++) stepBattle(w, b); stepAttacks(w); resolveDeaths(w);
  const gap = Math.hypot(b.fighters[0].x - b.fighters[1].x, b.fighters[0].y - b.fighters[1].y) * scale;
  assert.ok(gap >= BATTLE_SPACING * .98); assert.ok(gap < BATTLE_SPACING * 1.3); assert.ok(SPLASH_RADIUS * scale > BATTLE_SPACING);
});

test('fort shots aim and land at different opaque locations on each building sprite', () => {
  const w = make(), p = w.provinces.find(p => p.owner === -1)!;
  for (const kind of ['hq', 'barracks', 'launcherWorks', 'attachmentWorks', 'mine', null] as const) {
    p.building = kind; const locations = new Set<string>(), size = buildingWidth(p) / battleFrame(p).scale;
    for (let i = 0; i < 35; i++) { const aim = fortAim(w, p.id); locations.add(`${aim.x},${aim.y}`); assert.ok(BUILDING_HITS[kind?.endsWith('Works') ? 'workshop' : kind ?? 'fort'].some(([x, y]) => Math.abs(aim.x - FORT.x - x * size) < 1e-6 && Math.abs(aim.y - FORT.y - y * size) < 1e-6)); }
    assert.ok(locations.size > 10);
  }
  p.building = 'launcherWorks'; const b = addBattle(w, p.id, [soldier(w, 0, 'launcher')]); reinforce(w, b);
  const attacker = b.fighters[0]; attacker.x = FORT.x - 180; attacker.y = FORT.y; attacker.angle = 0; attacker.cooldown = 0;
  const impacts = new Set<string>();
  for (let i = 0; i < 180; i++) { stepBattle(w, b); stepAttacks(w); resolveDeaths(w); for (const v of w.visuals) if (v.kind === 'fort-hit') impacts.add(`${v.x},${v.y}`); }
  assert.ok(p.hp < 1000); assert.ok(impacts.size > 5);
  const near = fortAim(w, p.id), hp = p.hp; attacker.x = near.x - 1; attacker.y = near.y; attacker.fortAim = near; attacker.angle = 0; attacker.cooldown = 0;
  stepBattle(w, b); stepAttacks(w); resolveDeaths(w); assert.ok(p.hp < hp); assert.ok(w.visuals.some(v => v.kind === 'fort-hit' && v.x === (battleFrame(p).x + near.x * battleFrame(p).scale) && v.y === (battleFrame(p).y + near.y * battleFrame(p).scale)));
});
