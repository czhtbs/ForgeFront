import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { createWorld, allTroops } from '../src/sim/world.ts';
import { advanceAuthority } from '../src/sim/lockstep.ts';
import { encodeState, hashState, mapData } from '../src/sim/snapshot.ts';
import { simulationVersion } from '../server/version.mjs';

const { chromium, firefox } = createRequire(import.meta.url)('playwright');
const w = createWorld({ seed: 4521, count: 80, enemies: 5, difficulty: 'hard', multiplayer: true });
w.factions.forEach(f => f.ai = true);
const effects = ['blast', 'arc', 'burn', 'frost', 'pierce', 'homing', 'split', 'linger', 'return', 'delay', 'bounce'];
for (const p of w.provinces) p.troops.forEach((s, i) => { s.effects = [effects[i % effects.length]]; if (i < 8) s.effects.push('lob'); if (i >= 30) { s.weapon = 'hilt'; s.ammo = 'blade'; } });
const initial = encodeState(w), map = mapData(w), frames = [], states = new Map(), samples = [];
for (let i = 0; i < 3600 && w.winner === null; i++) {
  const commands = i === 0 ? w.factions.map(f => {
    const p = w.provinces[f.hq], target = p.neighbors.find(n => w.provinces[n].owner !== f.id);
    return { player: f.id, seq: 0, command: { type: 'armyOrder', units: p.troops.map(s => s.id), province: target } };
  }) : [];
  const { frame } = advanceAuthority(w, commands); frames.push(frame);
  if (frame.hash) states.set(frame.tick, encodeState(w));
  if (i % 300 === 0) samples.push({ tick: w.tick, units: allTroops(w).length, battles: w.battles.length, projectiles: w.projectiles.length, fields: w.fields.length });
}
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'replay-page', configureServer(vite) { vite.middlewares.use('/replay-check', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Logic replay test</title>'); }); } }] });
mkdirSync('.cache', { recursive: true }); writeFileSync('.cache/multiplayer-replay.json', JSON.stringify({ initial, map, frames, expected: hashState(w) }));
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/replay-check`;
const results = [];
try {
  for (const [name, engine, options] of [['Edge', chromium, { channel: 'msedge' }], ['Firefox', firefox, {}]]) {
    const browser = await engine.launch({ headless: true, ...options });
    try {
      const page = await browser.newPage(); await page.goto(url);
      const result = await page.evaluate(async ({ initial, map, frames }) => {
        const { decodeState, encodeState, hashState } = await import('/src/sim/snapshot.ts');
        const { applyFrame } = await import('/src/sim/lockstep.ts');
        let w = decodeState(initial, map);
        for (const frame of frames) {
          applyFrame(w, frame);
          if (frame.hash && hashState(w) !== frame.hash) return { tick: w.tick, state: encodeState(w), hash: hashState(w), expected: frame.hash };
          if ([599, 1349].includes(w.tick)) w = decodeState(encodeState(w), map);
        }
        return { tick: w.tick, hash: hashState(w) };
      }, { initial, map, frames });
      if (result.state) {
        const expected = JSON.parse(states.get(result.tick)), actual = JSON.parse(result.state), differences = [];
        function compare(a, b, path = '') {
          if (differences.length >= 8 || Object.is(a, b)) return;
          if (a && b && typeof a === 'object' && typeof b === 'object') for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare(a[key], b[key], `${path}.${key}`);
          else differences.push({ path, expected: a, actual: b });
        }
        compare(expected, actual); console.log(JSON.stringify({ engine: name, tick: result.tick, differences }, null, 2));
      }
      results.push({ engine: name, version: browser.version(), tick: result.tick, hash: result.hash });
      assert.equal(result.hash, hashState(w), `${name} diverged at tick ${result.tick}`);
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
const report = { version: simulationVersion(), node: process.version, scenario: '80 provinces, 6 AI, 120 seconds, mixed melee/artillery and all damage effects; same initial snapshot and command log', commands: frames.reduce((n, f) => n + f.commands.length, 0), samples, results };
mkdirSync('docs/verification', { recursive: true }); writeFileSync('docs/verification/multiplayer-replay.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
