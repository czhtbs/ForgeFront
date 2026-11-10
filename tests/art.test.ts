import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMap, mapBounds, inside, CELL_AREA, MAP_SIZES, coastalCells, distance } from '../src/sim/map.ts';
import { polygonArea, formation, fortPosition, SOLDIER_SIZE, battleFrame } from '../src/sim/spatial.ts';
import { decorations, buildingWidth, appear, revealedLine, UNIT_WEAPONS, ARMY_PORTRAITS, unitFrame, portraitFrame } from '../src/render/art.ts';
import { FACTION_COLORS } from '../src/sim/types.ts';
import { createWorld, connect, trainingBattle } from '../src/sim/world.ts';
import { routeGeometry } from '../src/render/geometry.ts';

test('40/60/80 irregular tiles keep the same average area and unit/building scale', () => {
  let lastArea = 0;
  for (const { count } of MAP_SIZES) {
    const cells = createMap(count, 4521), bounds = mapBounds(cells);
    assert.equal(cells.length, count); assert.ok(bounds.width * bounds.height > lastArea); lastArea = bounds.width * bounds.height;
    const areas = cells.map(p => polygonArea(p.polygon));
    assert.ok(Math.abs(areas.reduce((a, b) => a + b, 0) / count - CELL_AREA) < 1e-6);
    assert.ok(Math.max(...areas) - Math.min(...areas) > CELL_AREA * .3);
    assert.ok(cells.some(p => p.polygon.length !== 6));
    for (const p of cells) {
      assert.equal(battleFrame(p).scale, .12); assert.equal(SOLDIER_SIZE, 2.7);
      for (const n of p.neighbors) assert.ok(p.polygon.filter(a => cells[n].polygon.some(b => Math.hypot(a.x - b.x, a.y - b.y) < .01)).length >= 2);
      assert.ok(formation(p, 60).every(point => inside(point, p.polygon)));
      p.building = 'hq'; const fort = fortPosition(p), size = buildingWidth(p) / 2;
      for (const dx of [-size, size]) for (const dy of [-size, size]) assert.ok(inside({ x: fort.x + dx, y: fort.y + dy }, p.polygon));
    }
  }
});

test('wavy borders share the same sampled curve and keep each side selectable without gaps', () => {
  const cells = createMap(40, 4521), edges = new Map();
  const key = p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
  for (const p of cells) {
    assert.ok(p.polygon.length > 20);
    p.polygon.forEach((a, i) => {
      const b = p.polygon[(i + 1) % p.polygon.length], id = [key(a), key(b)].sort().join('/'), edge = edges.get(id) ?? { a, b, owners: [] };
      edge.owners.push(p.id); edges.set(id, edge);
    });
  }
  let checked = 0;
  for (const { a, b, owners } of edges.values()) {
    assert.ok(owners.length <= 2);
    if (owners.length !== 2 || Math.hypot(a.x - b.x, a.y - b.y) < .1) continue;
    assert.ok(cells[owners[0]].neighbors.includes(owners[1]));
    const length = Math.hypot(b.x - a.x, b.y - a.y), middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    for (const sign of [-1, 1]) {
      const point = { x: middle.x - (b.y - a.y) / length * .01 * sign, y: middle.y + (b.x - a.x) / length * .01 * sign };
      assert.equal(owners.filter(id => inside(point, cells[id].polygon)).length, 1);
    }
    checked++;
  }
  assert.ok(checked > 300);
});

test('seeded map outlines include rectangular, elliptical, wide and tall landmasses', () => {
  const shapes = Array.from({ length: 12 }, (_, i) => {
    const cells = createMap(40, i + 1), b = mapBounds(cells), area = cells.reduce((sum, p) => sum + polygonArea(p.polygon), 0);
    assert.ok(cells.every(p => inside(p, p.polygon)));
    return { fill: area / (b.width * b.height), aspect: b.width / b.height };
  });
  assert.ok(shapes.some(s => s.fill > .9)); assert.ok(shapes.some(s => s.fill < .82));
  assert.ok(shapes.some(s => s.aspect > 1.5)); assert.ok(shapes.some(s => s.aspect < .7));
});

test('single decor sprites, scattered or clustered, stay entirely within their own tile', () => {
  for (const seed of [4521, 12, 9781]) for (const p of createMap(80, seed)) {
    const placed = decorations(p, seed); assert.deepEqual(placed, decorations(p, seed));
    assert.ok(placed.every(d => d.size <= 23));
    for (const d of placed) for (const dx of [-d.size / 2, d.size / 2]) for (const dy of [-d.size / 2, d.size / 2]) assert.ok(inside({ x: d.x + dx, y: d.y + dy }, p.polygon));
    assert.ok(placed.length <= (p.terrain === 2 ? 7 : p.terrain === 3 ? 2 : 1));
  }
});

test('supply routes attach to actual buildings and reveal continuously along their length', () => {
  const w = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal' });
  const home = w.provinces[w.factions[0].hq], source = w.provinces[home.neighbors[0]];
  source.owner = 0; source.building = 'launcherWorks'; assert.equal(connect(w, source.id, home.id), null);
  const points = routeGeometry(w, w.routes[0]).map(v => ({ x: v.point.x, y: v.point.y }));
  assert.deepEqual(points[0], fortPosition(source)); assert.deepEqual(points.at(-1), fortPosition(home));
  assert.deepEqual(revealedLine(points, 1), points);
  const half = revealedLine([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }], .5);
  assert.deepEqual(half.at(-1), { x: 10, y: 10 }); assert.equal(appear(-1, .5), 0); assert.equal(appear(.5, .5), 1);
  assert.ok(appear(.15, .5) < appear(.3, .5));
});

test('game assets exist and contain PNG data', () => {
  for (const name of ['hq', 'barracks', 'workshop', 'mine', 'fort', 'tree', 'pine', 'mountain', 'army-portraits', 'soldiers', 'soldier-debris']) {
    const png = readFileSync(new URL(`../public/assets/b-style/${name}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(0), 0x89504e47); assert.ok(png.length > 100);
  }
  const scene = readFileSync(new URL('../src/render/MapScene.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(scene, /private port\(|assets\/unit-parts/);
});

test('training deployments also fit the smaller fixed tile at every supported battle size', () => {
  for (const amount of [40, 120, 160]) {
    const w = createWorld({ seed: 4521, count: 10, enemies: 1, difficulty: 'normal', training: true });
    const id = trainingBattle(w, { weapon: 'launcher', ammo: 'round', effects: [] }, amount), p = w.provinces[id];
    assert.ok(w.battles[0].reserve.every(s => inside(s.position!, p.polygon)));
  }
});

test('one to five AI start inland with distinct headquarters, colors and a neighboring mine', () => {
  for (const count of [40, 60, 80]) for (const enemies of [1, 2, 3, 4, 5]) for (const seed of [1, 5, 9, 4521]) {
    const w = createWorld({ seed, count, enemies, difficulty: 'normal' }), coast = coastalCells(w.provinces), headquarters = w.factions.map(f => w.provinces[f.hq]);
    assert.equal(w.factions.length, enemies + 1); assert.equal(new Set(headquarters.map(p => p.id)).size, enemies + 1);
    assert.equal(new Set(w.factions.map(f => f.color)).size, enemies + 1);
    for (const p of headquarters) { assert.ok(!coast.has(p.id), `${count}/${seed}/${enemies}: coastal HQ`); assert.ok(p.neighbors.some(id => w.provinces[id].owner === p.owner && w.provinces[id].building === 'mine')); assert.equal(p.troops.length, 40); }
    for (const p of headquarters) for (const q of headquarters) if (p.id !== q.id) assert.ok(distance(p, q) > 50);
  }
});

test('soldier and army portrait atlases cover all six factions and the sword icon', () => {
  const image = readFileSync(new URL('../public/assets/b-style/soldiers.png', import.meta.url)), frames = image.readUInt32BE(16) / 160 * image.readUInt32BE(20) / 160;
  const portraits = readFileSync(new URL('../public/assets/b-style/army-portraits.png', import.meta.url));
  assert.equal(frames, FACTION_COLORS.length * UNIT_WEAPONS.length * 4); assert.equal(portraits.readUInt32BE(16), ARMY_PORTRAITS.length * 32);
  const columns = image.readUInt32BE(16) / 160;
  for (let owner = 0; owner < FACTION_COLORS.length; owner++) {
    for (const loadout of [{ weapon: null, ammo: null, effects: [] }, { weapon: 'launcher', ammo: 'round', effects: [] }, { weapon: 'launcher', ammo: 'round', effects: ['lob'] }, { weapon: 'hilt', ammo: 'blade', effects: [] }]) {
      const unit = { owner, ...loadout };
      for (const recoil of [0, 1]) assert.equal(Math.floor(unitFrame(unit, recoil) / columns), owner);
      if (unit.weapon === 'hilt') assert.equal(ARMY_PORTRAITS[portraitFrame(unit)], 'sword');
    }
  }
});
