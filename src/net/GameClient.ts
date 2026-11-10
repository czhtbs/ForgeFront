import type { Command } from '../sim/commands.ts';
import type { Settings, World } from '../sim/types.ts';
import { STEP } from '../sim/types.ts';
import { Replica } from './Replica.ts';
import { SIM_VERSION } from './protocol.ts';
import type { ClientMessage, Lobby, ServerMessage } from './protocol.ts';

interface Callbacks {
  lobby(lobby: Lobby, player: number): void;
  start(world: World, player: number): void;
  restore(world: World): void;
  status(text: string): void;
  error(message: string): void;
}
export class GameClient {
  replica = new Replica();
  player = -1;
  private socket?: WebSocket;
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private seq = 0;
  private pending = new Map<number, Command>();
  private token = '';
  private elapsed = 0;
  private syncing = false;
  private ready = false;
  private callbacks: Callbacks;
  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks;
    const saved = sessionStorage.getItem('forgefront-session');
    if (saved) { const state = JSON.parse(saved); this.token = state.token; this.seq = state.seq; this.pending = new Map(state.pending); }
  }
  private save() { sessionStorage.setItem('forgefront-session', JSON.stringify({ token: this.token, seq: this.seq, pending: [...this.pending] })); }
  private send(message: ClientMessage) { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  connect() {
    this.callbacks.status('连接中'); this.ready = false;
    const url = new URL('socket', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = this.socket = new WebSocket(url);
    socket.onopen = () => this.send({ type: 'hello', version: SIM_VERSION, token: this.token });
    socket.onmessage = event => {
      const message: ServerMessage = JSON.parse(event.data);
      switch (message.type) {
        case 'welcome': this.player = message.player; this.token = message.token; this.save(); break;
        case 'lobby': this.ready = true; this.pending.clear(); this.seq = 0; this.save(); this.callbacks.status('大厅'); this.callbacks.lobby(message.lobby, this.player); break;
        case 'start':
        case 'snapshot': {
          try { this.replica.restore(message.recovery, message.type === 'start' ? message.map : undefined); }
          catch (error) { this.stop(); this.callbacks.error((error as Error).message); this.callbacks.status('同步失败'); return; }
          for (const seq of this.pending.keys()) if (seq <= message.recovery.processed) this.pending.delete(seq);
          this.seq = Math.max(this.seq, message.recovery.processed); this.save();
          this.syncing = false; this.ready = true; this.elapsed = 0;
          if (message.type === 'start') this.callbacks.start(this.replica.world, this.player);
          else this.callbacks.restore(this.replica.world);
          this.callbacks.status('联机');
          for (const [seq, command] of this.pending) this.send({ type: 'command', seq, command });
          break;
        }
        case 'frame': this.replica.receive(message.frame); break;
        case 'result': this.pending.delete(message.seq); this.save(); if (message.error) this.callbacks.error(message.error); break;
        case 'error': if (message.fatal) this.stop(); this.callbacks.error(message.message); this.callbacks.status(message.message); break;
      }
    };
    socket.onclose = event => {
      this.ready = false;
      if (event.code === 4001) { this.stop(); this.callbacks.status('已在另一页面连接'); return; }
      if (!this.stopped) { this.callbacks.status('重连中'); this.retry = setTimeout(() => this.connect(), 1500); }
    };
  }
  configure(settings: Settings, ai: number) { this.send({ type: 'configure', settings, ai }); }
  start() { this.send({ type: 'start' }); }
  command(command: Command): string | null {
    if (!this.ready || this.syncing || !this.replica.world) return '连接尚未就绪';
    const seq = ++this.seq; this.pending.set(seq, command); this.save(); this.send({ type: 'command', seq, command }); return null;
  }
  update(delta: number) {
    if (!this.ready || !this.replica.world) return 0;
    this.elapsed += delta;
    const steps = this.replica.advance(Math.min(180, Math.max(Math.floor(this.elapsed / STEP), this.replica.frames.length - 6)));
    this.elapsed = Math.min(STEP, Math.max(0, this.elapsed - steps * STEP));
    for (const digest of this.replica.hashes.splice(0)) this.send({ type: 'hash', ...digest });
    if (this.replica.waiting && !this.syncing) { this.syncing = true; this.callbacks.status('同步中'); if (!this.replica.mismatch) this.send({ type: 'resync' }); }
    return steps;
  }
  stop() { this.stopped = true; this.ready = false; clearTimeout(this.retry); this.socket?.close(); }
  leave() { this.send({ type: 'leave' }); this.stop(); sessionStorage.removeItem('forgefront-session'); }
}
