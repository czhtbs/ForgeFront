import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeState, encodeState, hashState } from '../src/sim/snapshot.ts';
import { applyFrame } from '../src/sim/lockstep.ts';
import { simulationVersion } from '../server/version.mjs';
const input = JSON.parse(readFileSync(process.argv[2] ?? '.cache/multiplayer-replay.json', 'utf8'));
let world = decodeState(input.initial, input.map);
for (const frame of input.frames) {
  applyFrame(world, frame);
  if (frame.hash) assert.equal(hashState(world), frame.hash, `Tick ${frame.tick}`);
  if ([599, 1349].includes(world.tick)) world = decodeState(encodeState(world), input.map);
}
assert.equal(hashState(world), input.expected);
console.log(JSON.stringify({ version: simulationVersion(), node: process.version, platform: process.platform, arch: process.arch, tick: world.tick, hash: hashState(world) }));
