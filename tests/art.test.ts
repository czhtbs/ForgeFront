import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createMap, mapBounds, inside, CELL_AREA, MAP_SIZES } from '../src/sim/map.ts';
import { polygonArea, formation, fortPosition, SOLDIER_SIZE, battleFrame } from '../src/sim/spatial.ts';
import { decorations, buildingWidth, appear, revealedLine, UNIT_WEAPONS } from '../src/render/art.ts';
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
      for (const n of p.neighbors) assert.equal(p.polygon.filter(a => cells[n].polygon.some(b => Math.hypot(a.x - b.x, a.y - b.y) < .01)).length, 2);
      assert.ok(formation(p, 60).every(point => inside(point, p.polygon)));
      p.building = 'hq'; const fort = fortPosition(p), size = buildingWidth(p) / 2;
      for (const dx of [-size, size]) for (const dy of [-size, size]) assert.ok(inside({ x: fort.x + dx, y: fort.y + dy }, p.polygon));
    }
  }
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
  source.owner = 0; source.building = 'workshop'; assert.equal(connect(w, source.id, home.id), null);
  const points = routeGeometry(w, w.routes[0]).map(v => ({ x: v.point.x, y: v.point.y }));
  assert.deepEqual(points[0], fortPosition(source)); assert.deepEqual(points.at(-1), fortPosition(home));
  assert.deepEqual(revealedLine(points, 1), points);
  const half = revealedLine([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }], .5);
  assert.deepEqual(half.at(-1), { x: 10, y: 10 }); assert.equal(appear(-1, .5), 0); assert.equal(appear(.5, .5), 1);
  assert.ok(appear(.15, .5) < appear(.3, .5));
});

test('game consumes new assets and all weapon/effect parts are available', () => {
  for (const name of ['hq', 'barracks', 'workshop', 'mine', 'fort', 'tree', 'pine', 'mountain', 'army-portraits', 'soldiers', 'soldier-debris', 'equipment-modules']) {
    const png = readFileSync(new URL(`../public/assets/b-style/${name}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(0), 0x89504e47); assert.ok(png.length > 100);
  }
  for (const name of ['body', ...UNIT_WEAPONS, 'pierce', 'blast', 'gas', 'split']) assert.ok(existsSync(new URL(`../public/assets/b-style/parts/${name}.svg`, import.meta.url)));
  const scene = readFileSync(new URL('../src/render/MapScene.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(scene, /private port\(|assets\/unit-parts/);
});

test('training deployments also fit the smaller fixed tile at every supported battle size', () => {
  for (const amount of [40, 120, 160]) {
    const w = createWorld({ seed: 4521, count: 10, enemies: 1, difficulty: 'normal', training: true });
    const id = trainingBattle(w, { weapon: 'mg', effects: [] }, amount), p = w.provinces[id];
    assert.ok(w.battles[0].reserve.every(s => inside(s.position!, p.polygon)));
  }
});
