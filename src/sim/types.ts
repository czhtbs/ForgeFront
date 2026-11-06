import type { Effect, Item, Weapon } from '../content/equipment.ts';
export interface Point { x: number; y: number }
export type Building = 'hq' | 'barracks' | 'workshop' | 'mine' | null;
export interface Soldier { id: number; owner: number; hp: number; weapon: Weapon; effects: Effect[]; recruit?: boolean; equipped?: boolean; position?: Point; angle?: number; slot?: number; marchSlot?: number; deployAt?: number; advanceTo?: Point; entry?: Point }
export interface Province extends Point {
  id: number; name: string; polygon: Point[]; neighbors: number[]; terrain: number; owner: number; hp: number;
  building: Building; level: number; troops: Soldier[]; mobile: Soldier[]; 
  output: Item; production: number; recruitment: number; productionKey: string; lastHit: number; capturedBy: number;
}
export interface Faction { id: number; name: string; color: number; gold: number; hq: number; alive: boolean; ai: boolean; intent: string }
export interface Waypoint extends Point { province: number }
export interface Route { id: number; owner: number; from: number; to: number; item: Item; via: Waypoint[]; path: number[]; status: 'normal' | 'delayed' | 'cut' | 'idle' }
export interface SupplyFlow { owner: number; from: number; to: number; item: Item; rate: number; start: number; end: number }
export interface Shipment extends Point { id: number; owner: number; from: number; to: number; path: number[]; leg: number; troops: Soldier[] }
export interface Fighter extends Soldier, Point { angle: number; cooldown: number; recoil: number; suppressed: number; target?: number; targetOwner?: number; killedBy?: number }
export interface Projectile extends Point { id: number; owner: number; vx: number; vy: number; damage: number; life: number; weapon: Weapon; effects: Effect[]; hits: number[] }
export interface Cloud extends Point { owner: number; life: number; radius: number }
export interface VisualEffect extends Point { kind: 'hit' | 'blast' | 'death' | 'flame'; life: number; max: number; angle: number }
export interface Battle { province: number; fighters: Fighter[]; reserve: Soldier[]; projectiles: Projectile[]; clouds: Cloud[]; visuals: VisualEffect[]; wave: number; nextDeploy: number[]; models: boolean; shots: number; losses: number[] }
export interface Settings { seed: number; count: number; enemies: number; difficulty: 'easy' | 'normal' | 'hard'; training?: boolean }
export interface World {
  settings: Settings; time: number; tick: number; nextId: number; rng: number;
  provinces: Province[]; factions: Faction[]; routes: Route[]; shipments: Shipment[]; battles: Battle[]; flows: SupplyFlow[];
  messages: { time: number; text: string }[]; winner: number | null; stats: { kills: number; losses: number }[]; result: { troops: number; land: number }[] | null;
}
export const STEP = 1 / 30;
export const CAPACITY = 60;
export const BATTLE_CAP = 240;
export const BATTLE_W = 900;
export const BATTLE_H = 600;
export const FACTION_COLORS = [0x208a8c, 0xd56f63, 0xb49742, 0x8879a4];
export const BUILDING_NAMES: Record<NonNullable<Building>, string> = { hq: '总部兵营', barracks: '兵营', workshop: '装备工坊', mine: '金矿' };

export const FORT = { x: 560, y: 300, radius: 75 };
