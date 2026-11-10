import type { ArtilleryOrder, Province, World } from './types.ts';
import { allTroops } from './world.ts';

export const STATE_VERSION = 2;
export type MapData = Pick<Province, 'id' | 'x' | 'y' | 'name' | 'polygon' | 'neighbors' | 'terrain'>[];
export const mapData = (w: World): MapData => w.provinces.map(({ id, x, y, name, polygon, neighbors, terrain }) => ({ id, x, y, name, polygon, neighbors, terrain }));

export function encodeState(w: World): string {
  const state = { ...w, visuals: [], casualties: [],
    provinces: w.provinces.map(({ x, y, name, polygon, neighbors, terrain, ...p }) => p) };
  return JSON.stringify(state, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

export function decodeState(state: string, map: MapData): World {
  const w: World = JSON.parse(state);
  w.provinces.forEach((p, i) => Object.assign(p, map[i]));
  // JSON duplicates objects: restore the shared order identity used for artillery formation groups.
  const orders = new Map<number, ArtilleryOrder>();
  for (const s of allTroops(w)) if (s.bombard) {
    if (!orders.has(s.bombard.id)) orders.set(s.bombard.id, s.bombard);
    s.bombard = orders.get(s.bombard.id);
  }
  return w;
}

export function hashState(w: World) {
  const state = encodeState(w);
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < state.length; i++) { const c = state.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 0x5bd1e995); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
