import { WORKSHOP_ITEMS, canFight } from '../content/equipment.ts';
import type { Item } from '../content/equipment.ts';
import type { Building, Point, Waypoint, World } from './types.ts';
import { allTroops, build, connect, disconnect, orderUnits, reroute, setFactoryOutput, surrender, upgrade, demolish, cancelUpgrade, cancelBuildingWork } from './world.ts';
import { inside } from './map.ts';
import { TECH } from '../content/research.ts';
import type { ResearchBranch } from '../content/research.ts';
import { startResearch, setTrialResearch, cancelResearch } from './research.ts';
import { BUILDING_COST } from './types.ts';

export type Command =
  | { type: 'build'; province: number; building: Exclude<Building, null | 'hq'> }
  | { type: 'upgrade'; province: number }
  | { type: 'demolish'; province: number }
  | { type: 'cancelUpgrade'; province: number }
  | { type: 'cancelBuild' | 'cancelDemolish' | 'cancelResearch'; province: number }
  | { type: 'output'; province: number; item: Item }
  | { type: 'research'; province: number; technology: string }
  | { type: 'trialResearch'; branch: ResearchBranch; level: number }
  | { type: 'connect'; from: number; to: number }
  | { type: 'disconnect'; route: number }
  | { type: 'reroute'; route: number; via: Waypoint[] }
  | { type: 'armyOrder'; units: number[]; province: number; point?: Point; targets?: number[] }
  | { type: 'surrender' };
export interface OrderedCommand { player: number; seq: number; command: Command }
export interface CommandFrame { tick: number; commands: OrderedCommand[]; hash?: string; ended?: boolean }

// Validate before calling simulation functions, which assume valid indices and owned entities.
export function normalizeCommand(w: World, owner: number, value: unknown): Command | null {
  if (!value || typeof value !== 'object' || !w.factions[owner]?.alive || w.winner !== null) return null;
  const c = value as Record<string, any>;
  const province = (id: unknown): id is number => Number.isInteger(id) && !!w.provinces[id as number];
  const owned = (id: unknown) => province(id) && w.provinces[id].owner === owner;
  const route = () => Number.isInteger(c.route) && w.routes.some(r => r.id === c.route && r.owner === owner);
  const point = (p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  const ids = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 20000 && v.every(Number.isSafeInteger);
  switch (c.type) {
    case 'build': return owned(c.province) && Object.hasOwn(BUILDING_COST, c.building) ? { type: c.type, province: c.province, building: c.building } : null;
    case 'research': return owned(c.province) && typeof c.technology === 'string' && Object.hasOwn(TECH, c.technology) ? { type: c.type, province: c.province, technology: c.technology } : null;
    case 'trialResearch': return w.settings.training && !w.settings.multiplayer && ['blast', 'burn', 'frost', 'arc', 'health', 'haste', 'mobility'].includes(c.branch) && Number.isInteger(c.level) && c.level >= 0 && c.level <= 3 ? { type: c.type, branch: c.branch, level: c.level } : null;
    case 'demolish':
    case 'cancelUpgrade':
    case 'cancelBuild':
    case 'cancelDemolish':
    case 'cancelResearch':
    case 'upgrade': return owned(c.province) ? { type: c.type, province: c.province } : null;
    case 'output': return owned(c.province) && Object.values(WORKSHOP_ITEMS).some(items => items.includes(c.item)) ? { type: c.type, province: c.province, item: c.item } : null;
    case 'connect': return owned(c.from) && owned(c.to) && c.from !== c.to ? { type: c.type, from: c.from, to: c.to } : null;
    case 'disconnect': return route() ? { type: c.type, route: c.route } : null;
    case 'reroute': return route() && Array.isArray(c.via) && c.via.length <= 64 && c.via.every((v: any) => point(v) && owned(v.province) && inside(v, w.provinces[v.province].polygon)) ? { type: c.type, route: c.route, via: c.via.map((v: Waypoint) => ({ x: v.x, y: v.y, province: v.province })) } : null;
    case 'armyOrder': {
      if (!province(c.province) || !ids(c.units) || c.targets !== undefined && !ids(c.targets) || c.point !== undefined && (!point(c.point) || !inside(c.point, w.provinces[c.province].polygon))) return null;
      const troops = allTroops(w), selected = new Set(c.units), targetIds = new Set(c.targets ?? []);
      const units = troops.filter(s => selected.has(s.id) && s.owner === owner && s.hp > 0 && canFight(s)).map(s => s.id);
      const targets = troops.filter(s => targetIds.has(s.id) && s.owner !== owner && s.hp > 0).map(s => s.id);
      return units.length ? { type: c.type, units, province: c.province, ...(c.point ? { point: { x: c.point.x, y: c.point.y } } : {}), ...(targets.length ? { targets } : {}) } : null;
    }
    case 'surrender': return { type: c.type };
    default: return null;
  }
}

export function executeCommand(w: World, owner: number, c: Command): string | null {
  switch (c.type) {
    case 'build': return build(w, c.province, c.building, owner);
    case 'upgrade': return upgrade(w, c.province, owner);
    case 'demolish': return demolish(w, c.province, owner);
    case 'cancelUpgrade': return cancelUpgrade(w, c.province, owner);
    case 'cancelBuild': return cancelBuildingWork(w, c.province, 'build', owner);
    case 'cancelDemolish': return cancelBuildingWork(w, c.province, 'demolish', owner);
    case 'cancelResearch': return cancelResearch(w, c.province, owner);
    case 'output': return setFactoryOutput(w, c.province, c.item, owner);
    case 'research': return startResearch(w, c.province, c.technology, owner);
    case 'trialResearch': return setTrialResearch(w, owner, c.branch, c.level);
    case 'connect': return connect(w, c.from, c.to, owner);
    case 'disconnect': disconnect(w, c.route, owner); return null;
    case 'reroute': return reroute(w, c.route, c.via, owner);
    case 'armyOrder': return orderUnits(w, c.units, c.province, owner, c.point, c.targets);
    case 'surrender': surrender(w, owner); return null;
  }
}

export function submitLocal(w: World, owner: number, value: unknown) {
  const command = normalizeCommand(w, owner, value);
  return command ? executeCommand(w, owner, command) : '指令已失效';
}
