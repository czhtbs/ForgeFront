import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { Room } from '../server/Room.mjs';
import { createGameServer } from '../server/index.mjs';
import { simulationVersion } from '../server/version.mjs';
import { Replica } from '../src/net/Replica.ts';
import { hashState } from '../src/sim/snapshot.ts';

function fixture(count = 2, ai = 0) {
  const room = new Room(), messages = Array.from({ length: count }, () => []);
  room.ai = ai;
  const members = messages.map((list, i) => room.join(`test-${i}`, null, m => list.push(m), () => {}));
  assert.equal(room.start(members[0]), null);
  const replicas = messages.map(list => { const start = list.find(m => m.type === 'start'), replica = new Replica(); replica.restore(start.recovery, start.map); list.length = 0; return replica; });
  const tick = () => { room.tick(); messages.forEach((list, i) => { for (const m of list.splice(0)) if (m.type === 'frame') replicas[i].receive(m.frame); replicas[i].advance(180, 0); }); };
  return { room, members, messages, replicas, tick };
}

test('two seats execute each command once and reject control of another faction', () => {
  const { room, members, replicas, messages, tick } = fixture(), p = room.world.provinces[room.world.factions[0].hq];
  const initial = room.world.factions[0].gold;
  room.request(members[0], 1, { type: 'upgrade', province: p.id });
  room.request(members[0], 1, { type: 'upgrade', province: p.id });
  room.request(members[1], 1, { type: 'upgrade', province: p.id });
  tick();
  assert.equal(p.level, 2); assert.ok(room.world.factions[0].gold < initial - 99);
  room.request(members[0], 1, { type: 'upgrade', province: p.id });
  assert.equal(messages[0].at(-1).seq, 1); tick(); assert.equal(p.level, 2);
  for (const r of replicas) assert.equal(hashState(r.world), hashState(room.world));
  assert.equal(members[1].processed, 1); assert.ok(members[1].results.get(1).error);
});

test('hash mismatch and a reconnect beyond the log window restore future state', () => {
  const { room, members, replicas, tick } = fixture(2, 2);
  for (let i = 0; i < 90; i++) tick();
  const a = replicas[0]; a.world.factions[0].gold += 7;
  room.check(members[0], 90, hashState(a.world)); assert.equal(room.resyncs, 1);
  a.restore(room.recovery(members[0])); assert.equal(hashState(a.world), hashState(room.world));
  room.disconnect(members[0], members[0].send);
  for (let i = 0; i < 360; i++) { room.tick(); }
  const messages = [], restored = room.join('test-0', members[0].token, m => messages.push(m), () => {});
  assert.equal(restored.player, 0); assert.ok(room.frames[0].tick > 90);
  const start = messages.find(m => m.type === 'start'); a.restore(start.recovery, start.map);
  assert.equal(hashState(a.world), hashState(room.world));
  for (let i = 0; i < 120; i++) { room.tick(); for (const m of messages.splice(0)) if (m.type === 'frame') a.receive(m.frame); a.advance(180, 0); }
  assert.equal(hashState(a.world), hashState(room.world));
});

test('an unacknowledged command resubmitted on reconnect cannot buy an upgrade twice', () => {
  const { room, members, tick } = fixture(), m = members[0], province = room.world.factions[0].hq;
  const command = { type: 'upgrade', province };
  room.request(m, 1, command); room.disconnect(m, m.send); tick();
  const restored = room.join('test-0', m.token, () => {}, () => {});
  assert.equal(room.recovery(restored).processed, 1);
  room.request(restored, 1, command); tick(); assert.equal(room.world.provinces[province].level, 2);
});

test('buffer does not skip missing ticks, slow replicas do not stop other players, final frames drain', () => {
  const { room, members, replicas } = fixture();
  for (let i = 0; i < 15; i++) room.tick();
  const a = replicas[0], b = replicas[1];
  for (const f of room.frames) a.receive(f); a.advance(180);
  assert.equal(a.world.tick, 12); assert.equal(b.world.tick, 0); assert.equal(room.world.tick, 15);
  b.receive(room.frames[1]); assert.equal(b.waiting, true); assert.equal(b.world.tick, 0);
  b.restore(room.recovery(members[1])); assert.equal(b.world.tick, 15);
  room.request(members[0], 1, { type: 'surrender' }); room.tick(); a.receive(room.frames.at(-1)); a.advance(180);
  assert.equal(a.world.tick, room.world.tick); assert.equal(a.world.winner, 1);
});

test('actual WebSocket transport verifies version and origin and replays two clients', async t => {
  const game = createGameServer({ origin: 'http://forgefront.test', autoTick: false });
  game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening');
  t.after(() => game.close());
  const url = `ws://127.0.0.1:${game.server.address().port}/socket`;
  const connect = async () => {
    const socket = new WebSocket(url, { origin: 'http://forgefront.test' }), messages = [];
    socket.on('message', data => messages.push(JSON.parse(data.toString()))); await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'hello', version: simulationVersion() }));
    await wait(() => messages.some(m => m.type === 'lobby'));
    return { socket, messages };
  };
  const a = await connect(), b = await connect();
  a.socket.send(JSON.stringify({ type: 'start' }));
  await wait(() => a.messages.some(m => m.type === 'start') && b.messages.some(m => m.type === 'start'));
  const replicas = [a, b].map(c => { const s = c.messages.find(m => m.type === 'start'), r = new Replica(); r.restore(s.recovery, s.map); c.messages.length = 0; return r; });
  a.socket.send(JSON.stringify({ type: 'command', seq: 1, command: { type: 'upgrade', province: game.room.world.factions[0].hq } }));
  await wait(() => game.room.pending.length === 1);
  for (let i = 0; i < 60; i++) game.room.tick();
  await wait(() => b.messages.filter(m => m.type === 'frame').length === 60);
  [a, b].forEach((c, i) => { for (const m of c.messages) if (m.type === 'frame') replicas[i].receive(m.frame); replicas[i].advance(180, 0); assert.equal(hashState(replicas[i].world), hashState(game.room.world)); });
  const wrong = new WebSocket(url, { origin: 'http://evil.test' });
  assert.match((await once(wrong, 'error'))[0].message, /403/);
});

async function wait(predicate) {
  const until = Date.now() + 4000;
  while (!predicate()) { if (Date.now() > until) throw new Error('WebSocket test timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
}

test('the production browser client submits, corrects corruption and reconnects without resubmitting an upgrade', async t => {
  const game = createGameServer({ autoTick: false }); game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening');
  const savedGlobals = Object.fromEntries(['WebSocket', 'sessionStorage', 'location', '__SIM_VERSION__'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const storage = new Map();
  Object.assign(globalThis, { WebSocket, sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, location: { href: `http://127.0.0.1:${game.server.address().port}/index.html`, protocol: 'http:' }, __SIM_VERSION__: simulationVersion() });
  const { GameClient } = await import('../src/net/GameClient.ts');
  const errors = [], events = [], callbacks = { lobby: () => events.push('lobby'), start: () => events.push('start'), restore: () => events.push('restore'), status() {}, error: e => errors.push(e) };
  const a = new GameClient(callbacks), b = new GameClient(callbacks);
  t.after(async () => { a.stop(); b.stop(); await game.close(); for (const [key, descriptor] of Object.entries(savedGlobals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  a.connect(); await wait(() => events.includes('lobby')); b.connect(); await wait(() => game.room.members.length === 2);
  a.start(); await wait(() => events.filter(e => e === 'start').length === 2);
  const province = a.replica.world.factions[0].hq;
  assert.equal(a.command({ type: 'upgrade', province }), null); await wait(() => game.room.pending.length === 1);
  for (let i = 0; i < 60; i++) game.room.tick();
  await wait(() => b.replica.frames.length === 60); a.update(2); b.update(2);
  assert.equal(a.replica.world.provinces[province].level, 2);
  a.replica.world.factions[0].gold += 77;
  for (let i = 0; i < 30; i++) game.room.tick();
  await wait(() => a.replica.frames.at(-1)?.tick === 90); a.update(1); b.update(1);
  await wait(() => events.includes('restore'));
  assert.equal(hashState(a.replica.world), hashState(game.room.world));
  for (const ws of game.sockets.clients) { ws.terminate(); break; }
  await wait(() => !game.room.members[0].send);
  for (let i = 0; i < 35; i++) game.room.tick();
  await wait(() => events.filter(e => e === 'start').length === 3);
  assert.equal(a.player, 0); assert.equal(hashState(a.replica.world), hashState(game.room.world));
  assert.equal(a.replica.world.provinces[province].level, 2); assert.deepEqual(errors, []);
});
