import test from 'node:test';
import assert from 'node:assert/strict';
import { allTroops, createWorld, orderUnits, soldier } from '../src/sim/world.ts';
import { advanceAuthority, applyFrame } from '../src/sim/lockstep.ts';
import { decodeState, encodeState, hashState, mapData } from '../src/sim/snapshot.ts';
import { formation } from '../src/sim/spatial.ts';
import { normalizeCommand } from '../src/sim/commands.ts';
import { sin, cos, atan2, hypot } from '../src/sim/math.ts';

const settings = { seed: 4521, count: 40, enemies: 3, difficulty: 'normal' as const, multiplayer: true };

test('shared simulation math retains sub-pixel numerical accuracy in every quadrant', () => {
  for (let i = -2000; i <= 2000; i++) {
    const a = i / 41, x = Math.cos(a) * 100, y = Math.sin(a) * 100;
    assert.ok(Math.abs(sin(a) - Math.sin(a)) < 1e-12);
    assert.ok(Math.abs(cos(a) - Math.cos(a)) < 1e-12);
    assert.ok(Math.abs(atan2(y, x) - Math.atan2(y, x)) < 1e-14);
    assert.ok(Math.abs(hypot(x, y) - 100) < 1e-12);
  }
  assert.equal(atan2(0, 0), 0);
});

test('formation expansion is independent of previous calls and survives JSON restoration', () => {
  const p = createWorld(settings).provinces[0], restored = JSON.parse(JSON.stringify(p));
  formation(p, 400); const points = formation(p, 800);
  assert.deepEqual(points, formation(restored, 800));
  formation(p, 1600); assert.deepEqual(points, formation(p, 800));
});

test('authoritative AI commands replay with matching state, including snapshot round trips', () => {
  const server = createWorld(settings); server.factions.forEach(f => f.ai = true);
  const map = mapData(server); let client = decodeState(encodeState(server), map), commands = 0;
  for (let i = 0; i < 1800 && server.winner === null; i++) {
    const { frame } = advanceAuthority(server); commands += frame.commands.length;
    applyFrame(client, JSON.parse(JSON.stringify(frame)));
    if (frame.hash) assert.equal(hashState(client), frame.hash, `tick ${frame.tick}`);
    if ([149, 400, 980].includes(i)) client = decodeState(encodeState(client), map);
  }
  assert.ok(commands > 10); assert.equal(hashState(client), hashState(server));
});

test('snapshot preserves shared artillery orders and every future combat state', () => {
  const server = createWorld(settings); server.factions.forEach(f => f.ai = false);
  const home = server.provinces[server.factions[0].hq], target = server.provinces[home.neighbors[0]]; target.owner = 1;
  home.troops = ['burn', 'frost', 'blast', 'arc'].map(effect => ({ ...soldier(server, 0), effects: ['lob', effect] as any }));
  assert.equal(orderUnits(server, home.troops.map(s => s.id), target.id), null);
  const client = decodeState(encodeState(server), mapData(server)), guns = allTroops(client).filter(s => s.bombard);
  assert.equal(guns.length, 4); assert.ok(guns.every(s => s.bombard === guns[0].bombard));
  for (let i = 0; i < 330; i++) { const { frame } = advanceAuthority(server); applyFrame(client, frame); }
  assert.equal(hashState(client), hashState(server));
});

test('commands reject foreign units, invalid indices, illegal routes and non-finite points', () => {
  const w = createWorld(settings), home = w.provinces[w.factions[0].hq], enemy = w.provinces[w.factions[1].hq];
  assert.equal(normalizeCommand(w, 0, { type: 'upgrade', province: enemy.id }), null);
  assert.equal(normalizeCommand(w, 0, { type: 'build', province: -1, building: 'mine' }), null);
  assert.equal(normalizeCommand(w, 0, { type: 'armyOrder', province: home.id, units: enemy.troops.map(s => s.id) }), null);
  assert.equal(normalizeCommand(w, 0, { type: 'armyOrder', province: enemy.id, units: [home.troops[0].id], point: { x: NaN, y: 0 } }), null);
  const c = normalizeCommand(w, 0, { type: 'armyOrder', province: enemy.id, units: [home.troops[0].id, enemy.troops[0].id, -1, home.troops[0].id] });
  assert.deepEqual(c?.type === 'armyOrder' && c.units, [home.troops[0].id]);
});

test('dependent and partially rejected commands replay in authoritative order', () => {
  const w = createWorld(settings), p = w.provinces.find(p => !p.building)!; p.owner = 0;
  const client = decodeState(encodeState(w), mapData(w));
  const { frame, results } = advanceAuthority(w, [
    { player: 0, seq: 1, command: { type: 'build', province: p.id, building: 'launcherWorks' } },
    { player: 0, seq: 2, command: { type: 'output', province: p.id, item: 'sword' } },
    { player: 0, seq: 3, command: { type: 'build', province: p.id, building: 'mine' } },
  ]);
  assert.equal(results[0].error, null); assert.equal(results[1].error, null); assert.ok(results[2].error);
  applyFrame(client, frame); assert.equal(client.provinces[p.id].output, 'sword'); assert.equal(hashState(client), hashState(w));
  assert.throws(() => applyFrame(client, { tick: 3, commands: [] }), /指令帧缺失/);
});

test('losing player zero does not end a multiplayer game with other contenders', () => {
  const w = createWorld(settings), client = decodeState(encodeState(w), mapData(w));
  const { frame } = advanceAuthority(w, [{ player: 0, seq: 1, command: { type: 'surrender' } }]);
  applyFrame(client, frame); assert.equal(w.winner, null); assert.equal(w.factions[0].alive, false);
  assert.equal(hashState(client), hashState(w));
});
