import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.mjs';
import { simulationVersion } from '../server/version.mjs';
import { decodeState, encodeState, mapData, hashState } from '../src/sim/snapshot.ts';
import { executeCommand } from '../src/sim/commands.ts';
import { allTroops } from '../src/sim/world.ts';
import { runAI } from '../src/ai/strategy.ts';

// Real TCP/WebSocket connections share a single 3 Mbps server-to-client pipe, with latency and jitter.
const game = createGameServer(); game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening');
const links = new Set(), connections = new Set(); let wireBytes = 0, peakQueued = 0, rng = 123;
const jitter = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return 60 + rng % 61; };
const proxy = createServer(client => {
  const upstream = connect(game.server.address().port, '127.0.0.1'), link = { client, upstream, queue: [], last: 0 };
  links.add(link); connections.add(client); connections.add(upstream);
  upstream.on('data', data => { link.last = Math.max(link.last, Date.now() + jitter()); link.queue.push({ data, at: link.last }); });
  let inbound = Promise.resolve();
  client.on('data', data => { inbound = inbound.then(() => new Promise(resolve => setTimeout(resolve, jitter() / 2))).then(() => { if (!upstream.destroyed) upstream.write(data); }); });
  const close = () => { links.delete(link); client.destroy(); upstream.destroy(); connections.delete(client); connections.delete(upstream); };
  client.on('close', close); upstream.on('close', close); client.on('error', close); upstream.on('error', close);
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
let budget = 0, last = performance.now();
const throttle = setInterval(() => {
  const now = performance.now(); budget = Math.min(3750, budget + (now - last) * 375); last = now;
  peakQueued = Math.max(peakQueued, [...links].reduce((n, link) => n + link.queue.reduce((n, c) => n + c.data.length, 0), 0));
  for (const link of links) while (budget >= 1 && link.queue.length && link.queue[0].at <= Date.now()) {
    const chunk = link.queue[0], length = Math.min(Math.floor(budget), chunk.data.length);
    link.client.write(chunk.data.subarray(0, length)); wireBytes += length; budget -= length;
    if (length === chunk.data.length) link.queue.shift(); else chunk.data = chunk.data.subarray(length);
  }
}, 10);
const storage = new Map();
Object.assign(globalThis, { WebSocket, sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, location: { href: `http://127.0.0.1:${proxy.address().port}/index.html`, protocol: 'http:' }, __SIM_VERSION__: simulationVersion() });
const { GameClient } = await import('../src/net/GameClient.ts');
const clients = [], statuses = [], errors = [], recoveries = [], samples = [], orderTimes = [], latencies = [];
let driver, sampler;
try {
  for (let i = 0; i < 6; i++) {
    storage.clear();
    const client = new GameClient({ lobby() {}, start() { statuses.push({ client: i, kind: 'start', at: Date.now() }); }, restore() { recoveries.push({ client: i, at: Date.now() }); }, status(text) { if (text !== '联机') statuses.push({ client: i, text, at: Date.now() }); }, error: message => errors.push(message) });
    clients.push(client); client.connect(); await wait(() => game.room.members.length === i + 1 && client.player === i);
    if (i === 0) { client.configure({ seed: 4521, count: 80, enemies: 5, difficulty: 'hard' }, 0); await wait(() => game.room.ai === 0); }
  }
  clients[0].start(); await wait(() => clients.every(c => c.replica.world), 15000);
  const started = Date.now(), initialBytes = wireBytes; let previous = performance.now(), secondBytes = wireBytes;
  const faults = new Set();
  driver = setInterval(() => {
    const now = performance.now(), delta = (now - previous) / 1000; previous = now;
    const elapsed = (Date.now() - started) / 1000;
    clients.forEach((c, i) => { if (i === 4 && elapsed >= 20 && elapsed < 24 || i === 5 && elapsed >= 25 && elapsed < 34) return; c.update(delta); });
    if (elapsed > 45 && !faults.has('disconnect')) { faults.add('disconnect'); clients[2].socket.terminate(); }
    if (elapsed > 60 && !faults.has('corrupt')) { faults.add('corrupt'); clients[1].replica.world.factions[1].gold += 99; }
    for (const record of orderTimes) {
      const result = game.room.members[record.player].results.get(record.seq);
      if (!record.done && result && clients[record.player].replica.world.tick >= result.tick) { record.done = true; latencies.push(Date.now() - record.at); }
    }
  }, 16);
  sampler = setInterval(() => {
    samples.push({ second: Math.round((Date.now() - started) / 1000), bytes: wireBytes - secondBytes, tick: game.room.world.tick, units: allTroops(game.room.world).length, battles: game.room.world.battles.length, backlog: clients.map(c => game.room.world.tick - c.replica.world.tick) }); secondBytes = wireBytes;
  }, 1000);
  for (let cycle = 0; cycle < 30; cycle++) {
    if (game.room.world.winner !== null) break;
    for (const [owner, client] of clients.entries()) {
      const planning = decodeState(encodeState(game.room.world), mapData(game.room.world));
      runAI(planning, owner, command => {
        const error = executeCommand(planning, owner, command);
        const submitted = client.command(command);
        if (!submitted) orderTimes.push({ player: owner, at: Date.now(), seq: client.seq, done: false });
        return error;
      });
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    if ((cycle + 1) % 10 === 0) console.log(`Network test: ${cycle + 1}/30 cycles, tick ${game.room.world.tick}, ${game.room.resyncs} recoveries`);
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
  clearInterval(driver); clearInterval(sampler);
  // Stop the authority, then drain already received frames to compare the exact same tick.
  const finalTick = game.room.world.tick, finalHash = hashState(game.room.world), originalTick = game.room.tick;
  game.room.tick = () => {};
  await wait(() => clients.every(c => c.replica.frames.at(-1)?.tick === finalTick || c.replica.world.tick === finalTick));
  for (const c of clients) { c.replica.advance(180, 0); assert.equal(hashState(c.replica.world), finalHash); }
  game.room.tick = originalTick;
  assert.ok(recoveries.some(r => r.client === 1)); assert.ok(recoveries.some(r => r.client === 5));
  assert.equal(statuses.filter(s => s.client === 2 && s.kind === 'start').length, 2);
  assert.ok(samples.some(s => s.second >= 25 && s.second < 34 && s.backlog[5] > 90 && s.backlog[0] < 20));
  assert.ok(samples.every(s => s.bytes <= 375000 * 1.05));
  const normal = samples.filter(s => s.second < 20 || s.second > 37 && s.second < 44 || s.second > 50 && s.second < 59 || s.second > 65);
  latencies.sort((a, b) => a - b);
  const report = { version: simulationVersion(), durationSeconds: (Date.now() - started) / 1000, clients: 6, factions: 6, mapSize: 80, limit: '3 Mbps aggregate TCP payload, 60–120 ms downstream jitter plus 30–60 ms upstream delay; TLS/IP overhead excluded', initialBytes, totalWireBytes: wireBytes, steadyAverageMbps: normal.reduce((n, s) => n + s.bytes, 0) / normal.length * 8 / 1e6, peakSecondMbps: Math.max(...samples.map(s => s.bytes)) * 8 / 1e6, peakQueuedBytes: peakQueued, finalTick, finalHash, recoveryCount: game.room.resyncs, recoveries, expectedCommandRejections: errors, samples };
  report.operationLatencyMs = { samples: latencies.length, median: latencies[Math.floor(latencies.length / 2)], p95: latencies[Math.floor(latencies.length * .95)], max: latencies.at(-1) };
  mkdirSync('docs/verification', { recursive: true }); writeFileSync('docs/verification/multiplayer-network.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, samples: `${samples.length} seconds recorded`, recoveries: recoveries.length, expectedCommandRejections: errors.length }, null, 2));
} finally {
  clearInterval(driver); clearInterval(sampler); clearInterval(throttle);
  clients.forEach(c => c.stop()); for (const c of connections) c.destroy(); proxy.close(); await game.close();
}
async function wait(predicate, timeout = 8000) { const until = Date.now() + timeout; while (!predicate()) { if (Date.now() > until) throw new Error('Network load test timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } }
