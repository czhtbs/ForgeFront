import type { Command, CommandFrame } from '../sim/commands.ts';
import type { MapData } from '../sim/snapshot.ts';
import type { Settings } from '../sim/types.ts';

// Generated from simulation sources by the build; dev and production must never mix versions.
export const SIM_VERSION = __SIM_VERSION__;
export interface Lobby {
  players: { player: number; connected: boolean }[];
  host: number;
  settings: Settings;
  ai: number;
}
export interface Recovery { state: string; tick: number; frames: CommandFrame[]; hash: string; processed: number; version: number }
export type ServerMessage =
  | { type: 'welcome'; player: number; token: string }
  | { type: 'lobby'; lobby: Lobby }
  | { type: 'start'; map: MapData; recovery: Recovery }
  | { type: 'snapshot'; recovery: Recovery }
  | { type: 'frame'; frame: CommandFrame }
  | { type: 'result'; seq: number; tick: number; error: string | null }
  | { type: 'error'; message: string; fatal?: boolean };
export type ClientMessage =
  | { type: 'hello'; version: string; token?: string }
  | { type: 'configure'; settings: Settings; ai: number }
  | { type: 'start' }
  | { type: 'command'; seq: number; command: Command }
  | { type: 'hash'; tick: number; hash: string }
  | { type: 'resync' }
  | { type: 'leave' };
