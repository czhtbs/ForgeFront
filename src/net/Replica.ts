import type { CommandFrame } from '../sim/commands.ts';
import { applyFrame } from '../sim/lockstep.ts';
import { decodeState, hashState, STATE_VERSION } from '../sim/snapshot.ts';
import type { MapData } from '../sim/snapshot.ts';
import type { World } from '../sim/types.ts';
import type { Recovery } from './protocol.ts';

export class Replica {
  world!: World;
  map!: MapData;
  frames: CommandFrame[] = [];
  waiting = false;
  mismatch = false;
  hashes: { tick: number; hash: string }[] = [];
  restore(recovery: Recovery, map = this.map) {
    if (recovery.version !== STATE_VERSION) throw new Error('状态版本不匹配');
    this.map = map; this.world = decodeState(recovery.state, map);
    if (this.world.tick !== recovery.tick) throw new Error('快照时间步不匹配');
    for (const frame of recovery.frames) applyFrame(this.world, frame);
    if (hashState(this.world) !== recovery.hash) throw new Error('恢复校验失败');
    this.world.visuals = []; this.world.casualties = [];
    this.frames = []; this.hashes = []; this.waiting = false; this.mismatch = false;
  }
  receive(frame: CommandFrame) {
    if (this.waiting || frame.tick <= this.world.tick) return;
    const previous = this.frames.at(-1)?.tick ?? this.world.tick;
    if (frame.tick !== previous + 1) { this.waiting = true; return; }
    this.frames.push(frame);
    if (this.frames.length > 180) this.waiting = true;
  }
  advance(limit = 1, buffer = 3) {
    let steps = 0;
    while (!this.waiting && steps < limit && this.frames.length > (this.frames.at(-1)?.ended ? 0 : buffer)) {
      const frame = this.frames.shift()!;
      applyFrame(this.world, frame); steps++;
      if (frame.hash) {
        const hash = hashState(this.world); this.hashes.push({ tick: frame.tick, hash });
        if (hash !== frame.hash) this.waiting = this.mismatch = true;
      }
    }
    if (steps > 1) { this.world.visuals = []; this.world.casualties = []; }
    return steps;
  }
}
