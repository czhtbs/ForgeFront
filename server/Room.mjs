import { randomUUID } from 'node:crypto';
import { createWorld } from '../src/sim/world.ts';
import { advanceAuthority } from '../src/sim/lockstep.ts';
import { encodeState, hashState, mapData, STATE_VERSION } from '../src/sim/snapshot.ts';

export class Room {
  members = [];
  world = null;
  settings = { seed: 4521, count: 40, enemies: 1, difficulty: 'normal' };
  ai = 1;
  pending = [];
  frames = [];
  snapshots = [];
  hashes = new Map();
  emptySince = 0;
  resyncs = 0;
  onMismatch = () => {};

  send(member, data) { member.send?.(data); }
  broadcast(data) { for (const m of this.members) this.send(m, data); }
  lobby() { return { players: this.members.map(m => ({ player: m.player, connected: !!m.send })), host: this.members.find(m => m.send)?.player ?? -1, settings: this.settings, ai: this.ai }; }
  updateLobby() { this.broadcast({ type: 'lobby', lobby: this.lobby() }); }

  join(identity, token, send, replace) {
    let member = this.members.find(m => identity ? m.identity === identity : token && m.token === token);
    if (!member) {
      if (this.world) throw new Error('对局已开始');
      if (this.members.length + this.ai >= 6) throw new Error('房间已满');
      member = { identity, token: randomUUID(), player: this.members.length, processed: 0, received: 0, results: new Map(), send: null, replace: null };
      this.members.push(member);
    }
    member.replace?.(); member.send = send; member.replace = replace; this.emptySince = 0;
    this.send(member, { type: 'welcome', player: member.player, token: member.token });
    if (this.world) this.send(member, { type: 'start', map: mapData(this.world), recovery: this.recovery(member) });
    else this.updateLobby();
    return member;
  }

  disconnect(member, send) {
    if (member.send !== send) return;
    member.send = null; member.replace = null;
    if (!this.world) { this.members = this.members.filter(m => m !== member); this.members.forEach((m, player) => { m.player = player; this.send(m, { type: 'welcome', player, token: m.token }); }); this.updateLobby(); }
    if (!this.members.some(m => m.send)) this.emptySince = Date.now();
  }

  configure(member, settings, ai) {
    if (this.world || member.player !== this.lobby().host) return '只有房主能修改设置';
    if (!settings || ![40, 60, 80].includes(settings.count) || !Number.isSafeInteger(settings.seed) || Math.abs(settings.seed) > 0xffffffff || !['easy', 'normal', 'hard'].includes(settings.difficulty) || !Number.isInteger(ai) || ai < 0 || ai > 5 || ai + this.members.length > 6) return '房间设置无效';
    this.settings = { seed: settings.seed, count: settings.count, difficulty: settings.difficulty, enemies: this.members.length + ai - 1 };
    this.ai = ai; this.updateLobby(); return null;
  }

  start(member) {
    if (this.world || member.player !== this.lobby().host) return '只有房主能开始对局';
    if (this.members.length + this.ai < 2 || this.members.some(m => !m.send)) return '至少需要两个阵营';
    this.world = createWorld({ ...this.settings, enemies: this.members.length + this.ai - 1, multiplayer: true });
    this.world.factions.forEach(f => { f.ai = f.id >= this.members.length; f.name = f.ai ? `AI ${f.id + 1}` : `玩家 ${f.id + 1}`; });
    this.save();
    for (const m of this.members) this.send(m, { type: 'start', map: mapData(this.world), recovery: this.recovery(m) });
    return null;
  }

  request(member, seq, command) {
    if (!this.world || !Number.isSafeInteger(seq) || seq < 1) return '指令格式无效';
    if (seq <= member.processed) {
      this.send(member, member.results.get(seq) ?? { type: 'result', seq, tick: this.world.tick, error: '指令已处理' }); return null;
    }
    if (seq <= member.received) return null;
    if (this.world.winner !== null) {
      member.processed = member.received = seq; this.send(member, { type: 'result', seq, tick: this.world.tick, error: '对局已结束' }); return null;
    }
    // Bound pending input at the WebSocket trust boundary, not the simulation.
    if (this.pending.filter(r => r.player === member.player).length >= 64) return '待处理指令过多';
    member.received = seq; this.pending.push({ player: member.player, seq, command }); return null;
  }

  tick() {
    if (!this.world || this.world.winner !== null) return;
    const { frame, results } = advanceAuthority(this.world, this.pending); this.pending = [];
    for (const r of results) {
      const m = this.members.find(m => m.player === r.player), result = { type: 'result', seq: r.seq, tick: frame.tick, error: r.error };
      m.processed = r.seq; m.results.set(r.seq, result);
      if (m.results.size > 128) m.results.delete(m.results.keys().next().value);
      this.send(m, result);
    }
    this.frames.push(frame);
    if (frame.hash) this.hashes.set(frame.tick, frame.hash);
    if (frame.tick % 30 === 0 || frame.ended) this.save();
    const oldest = this.world.tick - 300;
    this.frames = this.frames.filter(f => f.tick > oldest);
    this.snapshots = this.snapshots.filter(s => s.tick >= oldest);
    for (const tick of this.hashes.keys()) if (tick < oldest) this.hashes.delete(tick);
    this.broadcast({ type: 'frame', frame });
  }

  save() { const hash = hashState(this.world); this.hashes.set(this.world.tick, hash); this.snapshots.push({ tick: this.world.tick, state: encodeState(this.world) }); }
  recovery(member) {
    const snapshot = this.snapshots.at(-1);
    return { ...snapshot, version: STATE_VERSION, frames: this.frames.filter(f => f.tick > snapshot.tick), hash: hashState(this.world), processed: member.processed };
  }
  resync(member) { if (this.world) { this.resyncs++; this.send(member, { type: 'snapshot', recovery: this.recovery(member) }); } }
  check(member, tick, hash) {
    if (!this.world || !Number.isInteger(tick) || typeof hash !== 'string' || tick > this.world.tick) return;
    const expected = this.hashes.get(tick);
    if (expected && expected !== hash) this.onMismatch({ player: member.player, tick, expected, actual: hash, map: mapData(this.world), snapshot: this.snapshots[0], frames: this.frames.filter(f => f.tick > this.snapshots[0].tick) });
    if (!expected || expected !== hash) this.resync(member);
  }
}
