import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawDamageEffects, drawSoldierStatus } from '../src/render/damageEffects.ts';
import { createWorld, soldier } from '../src/sim/world.ts';
import { addBattle, reinforce, stepBattle } from '../src/sim/combat.ts';
import { toWorld } from '../src/sim/spatial.ts';

function drawing(w) {
  const calls = [], g = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  drawDamageEffects(w, g, (...args) => calls.push(['sprite', ...args]));
  for (const call of calls) for (const value of call) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  for (const call of calls.filter(c => c[0] === 'sprite')) { assert.ok(call[4] > 0 && call[5] > 0); assert.ok(call[7] >= 0 && call[7] <= 1); }
  return calls;
}
const world = () => createWorld({ seed: 4521, count: 12, enemies: 1, difficulty: 'normal' });

test('four payloads draw distinct finite effects without mutating the simulation or random stream', () => {
  const signatures = new Set();
  for (const kind of ['blast', 'arc', 'burn', 'frost']) {
    const w = world(); w.time = .5;
    if (kind === 'blast' || kind === 'arc') w.visuals = [{ kind, x: 10, y: 20, target: { x: 23, y: 20 }, life: .2, max: .5, angle: 0, radius: 6 }];
    else w.fields = [{ kind, x: 10, y: 20, radius: 4.5, owner: 0, province: 0, damage: 1, life: 2, pulse: 0 }];
    const before = structuredClone(w), calls = drawing(w);
    assert.ok(calls.length > 10); assert.ok(calls.filter(c => c[0] === 'sprite').length <= 10);
    assert.deepEqual(w, before); assert.deepEqual(drawing(w), calls);
    signatures.add(JSON.stringify(calls));
    if (kind === 'frost') { assert.ok(calls.some(c => c[0] === 'lineBetween')); assert.ok(!calls.some(c => c[0] === 'fillTriangle')); }
    if (kind === 'arc') assert.ok(calls.filter(c => c[0] === 'lineBetween').length > 10);
    if (kind === 'burn') { w.time += .1; assert.notDeepEqual(drawing(w), calls); }
  }
  assert.equal(signatures.size, 4);
});

test('fire stays small and dispersed, and snow drifts inside the circular field', () => {
  const w = world(), field = { kind: 'burn', x: 30, y: 50, radius: 4.5, owner: 0, province: 0, damage: 1, life: 2, pulse: 0 };
  w.fields = [field]; w.time = .6;
  const flames = drawing(w).filter(c => c[0] === 'sprite' && c[1] === 'flame');
  assert.equal(flames.length, 4); assert.ok(flames.every(c => c[5] < field.radius * .25));
  assert.ok(Math.max(...flames.map(c => c[2])) - Math.min(...flames.map(c => c[2])) > field.radius);
  assert.ok(Math.max(...flames.map(c => c[3])) - Math.min(...flames.map(c => c[3])) > field.radius * .6);
  field.kind = 'frost'; const before = drawing(w);
  for (const time of [.6, 1, 2]) {
    w.time = time;
    const lines = drawing(w).filter(c => c[0] === 'lineBetween'); assert.ok(lines.length > 30);
    for (const line of lines) for (const offset of [1, 3]) assert.ok(Math.hypot(line[offset] - field.x, line[offset + 1] - field.y) <= field.radius);
  }
  assert.notDeepEqual(drawing(w), before);
});

test('overlapping fire fields share a sparse visual layer without altering damage fields or RNG', () => {
  const w = world(), field = { kind: 'burn', x: 30, y: 50, radius: 10, owner: 0, province: 0, weapon: 'launcher', damage: 10, life: 2 };
  w.fields = Array.from({ length: 20 }, (_, i) => ({ ...field, x: 30 + i * .1, life: 2 + i * .01 }));
  const before = structuredClone(w), calls = drawing(w);
  assert.equal(calls.filter(c => c[0] === 'sprite' && c[1] === 'flame').length, 4); assert.deepEqual(w, before);
  w.fields.push({ ...field, x: 60 });
  assert.equal(drawing(w).filter(c => c[0] === 'sprite' && c[1] === 'flame').length, 8);
});

test('damage particles use local transparent 128px textures and leave other visuals alone', () => {
  for (const key of ['burst', 'flame', 'smoke', 'glow']) {
    const png = readFileSync(new URL(`../public/assets/fx/${key}.png`, import.meta.url));
    assert.equal(png.readUInt32BE(16), 128); assert.equal(png.readUInt32BE(20), 128);
  }
  const w = world(); w.visuals = [{ kind: 'hit', x: 0, y: 0, target: { x: 10, y: 0 }, life: .1, max: .2, angle: 0 }];
  assert.deepEqual(drawing(w), []);
});

test('melee effects use the shared area trigger and soldier status art never mutates simulation', () => {
  for (const [effect, kind] of [['blast', 'blast'], ['arc', 'arc'], ['burn', 'flame'], ['frost', 'frost']]) {
    const w = world(), p = w.provinces[0]; p.owner = 1; p.troops = []; p.mobile = [];
    const attacker = { ...soldier(w, 0, 'hilt'), effects: [effect] }, victim = soldier(w, 1), bystander = soldier(w, 1);
    const b = addBattle(w, p.id, [attacker, victim, bystander]); b.reserve.forEach(s => s.deployAt = 0); reinforce(w, b);
    b.fighters.forEach((s, i) => { s.x = 300 + i * 12; s.y = 200; s.position = toWorld(p, s); s.cooldown = i === 0 ? 0 : 100; });
    stepBattle(w, b);
    assert.equal(b.fighters[1].hp, 150 - (effect === 'blast' ? 40 : effect === 'arc' ? 30 : 0));
    assert.equal(b.fighters[2].hp, 200 - (effect === 'blast' ? 40 : effect === 'arc' ? 30 : 0));
    if (effect === 'blast' || effect === 'arc') assert.ok(w.visuals.some(v => v.kind === kind));
    else assert.equal(w.fields[0].kind, effect);
    const s = { ...victim, position: { x: 1, y: 1 }, burning: .8, chill: 80, shocked: .2 };
    const before = structuredClone(s), calls = [], g = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
    drawSoldierStatus(g, s, 1); assert.ok(calls.length > 10); assert.deepEqual(s, before);
  }
});
