import { runAI } from '../ai/strategy.ts';
import { executeCommand, normalizeCommand } from './commands.ts';
import type { Command, CommandFrame, OrderedCommand } from './commands.ts';
import type { World } from './types.ts';
import { STEP } from './types.ts';
import { stepWorld } from './world.ts';
import { hashState } from './snapshot.ts';

function finishTick(w: World) {
  if (w.winner === null) stepWorld(w);
  else { w.tick++; w.time = w.tick * STEP; }
}

export function advanceAuthority(w: World, requests: OrderedCommand[] = []) {
  const frame: CommandFrame = { tick: w.tick + 1, commands: [] };
  const results: { player: number; seq: number; error: string | null }[] = [];
  const apply = (player: number, seq: number, value: Command) => {
    const command = normalizeCommand(w, player, value);
    if (!command) return '指令已失效';
    // Keep validated attempts too: a partially successful group order must replay exactly once.
    frame.commands.push({ player, seq, command });
    return executeCommand(w, player, command);
  };
  for (const r of requests) results.push({ player: r.player, seq: r.seq, error: apply(r.player, r.seq, r.command) });
  const interval = w.settings.difficulty === 'easy' ? 240 : w.settings.difficulty === 'hard' ? 90 : 150;
  if (frame.tick % interval === 0 && w.winner === null) for (const f of w.factions) if (f.ai && f.alive) runAI(w, f.id, command => apply(f.id, 0, command));
  finishTick(w);
  if (w.winner !== null) frame.ended = true;
  if (w.tick % 30 === 0 || w.winner !== null) frame.hash = hashState(w);
  return { frame, results };
}

export function applyFrame(w: World, frame: CommandFrame) {
  if (frame.tick !== w.tick + 1) throw new Error(`指令帧缺失：${w.tick + 1} / ${frame.tick}`);
  for (const { player, command } of frame.commands) executeCommand(w, player, command);
  finishTick(w);
}

export function stepLocalWorld(w: World) { if (w.winner === null) advanceAuthority(w); }
