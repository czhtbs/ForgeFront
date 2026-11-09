import type { Effect, Item, Weapon, Ammo, Loadout, Workshop } from '../content/equipment.ts';
export interface Point { x: number; y: number }
export type Building = 'hq' | 'barracks' | Workshop | 'mine' | null;
export interface Soldier extends Loadout { id: number; owner: number; hp: number; recruit?: boolean; position?: Point; angle?: number; slot?: number; marchSlot?: number; deployAt?: number; advanceTo?: Point; entry?: Point; chill?: number; frozen?: number; killedBy?: number; hitAngle?: number; hitForce?: number; bombard?: { province: number; point: Point; target?: number }; artilleryCooldown?: number }
export interface Province extends Point {
  id: number; name: string; polygon: Point[]; neighbors: number[]; terrain: number; owner: number; hp: number;
  building: Building; level: number; troops: Soldier[]; mobile: Soldier[]; 
  output: Item; assembly: Partial<Record<Item, number>>; recruitment: number; lastHit: number; capturedBy: number;
}
export interface Faction { id: number; name: string; color: number; gold: number; hq: number; alive: boolean; ai: boolean; intent: string }
export interface Waypoint extends Point { province: number }
export interface Route { id: number; owner: number; from: number; to: number; item: Item; via: Waypoint[]; path: number[]; status: 'normal' | 'delayed' | 'cut' | 'idle' }
export interface SupplyFlow { owner: number; from: number; to: number; item: Item; rate: number; start: number; end: number }
export interface Shipment extends Point { id: number; owner: number; from: number; to: number; path: number[]; leg: number; troops: Soldier[] }
export interface Fighter extends Soldier, Point { angle: number; cooldown: number; recoil: number; suppressed: number; target?: number; targetOwner?: number; killedBy?: number; hitAngle?: number; hitForce?: number; fortAim?: Point }
export interface Projectile extends Point { id: number; owner: number; source: number; province: number | null; weapon: Weapon; ammo: Ammo; effects: Effect[]; vx: number; vy: number; damage: number; life: number; origin: Point; aim: Point; target?: number; remaining: number; hits: number[]; bounces: number; returning: boolean; airborne: boolean; lingered: boolean; phase: 'flight' | 'linger' | 'delay'; timer: number; pulse: number; trail: number; leaf: boolean }
export interface Field extends Point { owner: number; province: number | null; kind: 'burn' | 'frost' | 'arc' | 'blast'; life: number; radius: number; damage: number; pulse: number }
export interface VisualEffect extends Point { kind: 'hit' | 'fort-hit' | 'blast' | 'death' | 'flame' | 'arc' | 'frost' | 'beam'; life: number; max: number; angle: number; target?: Point }
export interface Casualty extends Point { id: number; owner: number; weapon: Weapon | null; angle: number; force: number; time: number }
export interface Battle { province: number; fighters: Fighter[]; reserve: Soldier[]; wave: number; nextDeploy: number[]; models: boolean; shots: number; losses: number[] }
export interface Settings { seed: number; count: number; enemies: number; difficulty: 'easy' | 'normal' | 'hard'; training?: boolean }
export interface World {
  settings: Settings; time: number; tick: number; nextId: number; rng: number;
  provinces: Province[]; factions: Faction[]; routes: Route[]; shipments: Shipment[]; battles: Battle[]; flows: SupplyFlow[];
  casualties: Casualty[];
  projectiles: Projectile[]; fields: Field[]; visuals: VisualEffect[];
  messages: { time: number; text: string }[]; winner: number | null; stats: { kills: number; losses: number }[]; result: { troops: number; land: number }[] | null;
}
export const STEP = 1 / 30;
export const CAPACITY = 60;
export const BATTLE_CAP = 240;
export const BATTLE_W = 900;
export const BATTLE_H = 600;
export const FACTION_COLORS = [0x208a8c, 0xd56f63, 0xb49742, 0x8879a4];
export const BUILDING_NAMES: Record<NonNullable<Building>, string> = { hq: '总部兵营', barracks: '兵营', launcherWorks: '发射器工坊', ammoWorks: '弹药工坊', attachmentWorks: '配件工坊', mine: '金矿' };

export const FORT = { x: 560, y: 300, radius: 75 };
