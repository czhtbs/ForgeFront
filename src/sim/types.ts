import type { Effect, Item, Weapon, Ammo, Loadout, Workshop, Payload } from '../content/equipment.ts';
export interface Point { x: number; y: number }
export interface ArtilleryOrder { id: number; province: number; point: Point; target?: number; targets?: number[]; center?: Point }
export type Building = 'hq' | 'barracks' | Workshop | 'mine' | 'researchLab' | null;
export interface BuildingWork { type: 'build' | 'demolish' | 'upgrade'; building: NonNullable<Building>; payer: number; cost: number; elapsed: number }
export interface Soldier extends Loadout { id: number; owner: number; hp: number; recruit?: boolean; transferRoute?: number; position?: Point; angle?: number; recoil?: number; slot?: number; marchSlot?: number; deployAt?: number; advanceTo?: Point; entry?: Point; chill?: number; frozen?: number; freezeElapsed?: number; freezeOwner?: number; frostImmune?: number; burning?: number; shocked?: number; burnNext?: number; retargetAt?: number; killedBy?: number; hitAngle?: number; hitForce?: number; bombard?: ArtilleryOrder; artilleryCooldown?: number }
export interface Province extends Point {
  id: number; name: string; polygon: Point[]; neighbors: number[]; terrain: number; owner: number; hp: number;
  building: Building; level: number; troops: Soldier[]; mobile: Soldier[]; 
  output: Item; assembly: Partial<Record<Item, number>>; recruitment: number; transferCursor?: number; lastHit: number; ammoConflict?: boolean; research?: { id: string; elapsed: number }; burnNext?: number; work?: BuildingWork;
}
export interface Faction { id: number; name: string; color: number; gold: number; hq: number; alive: boolean; ai: boolean; research: string[] }
export interface Waypoint extends Point { province: number }
export interface Route { id: number; owner: number; from: number; to: number; item: Item | 'recruits'; via: Waypoint[]; path: number[]; status: 'normal' | 'delayed' | 'cut' | 'idle' }
export interface SupplyFlow { owner: number; from: number; to: number; item: Item; rate: number; start: number; end: number }
export interface Shipment extends Point { id: number; owner: number; from: number; to: number; path: number[]; leg: number; troops: Soldier[]; transferRoute?: number }
export interface Fighter extends Soldier, Point { angle: number; cooldown: number; recoil: number; suppressed: number; target?: number; targetOwner?: number; killedBy?: number; hitAngle?: number; hitForce?: number; fortAim?: Point }
export interface Projectile extends Point { id: number; owner: number; source: number; province: number | null; weapon: Weapon; ammo: Ammo; effects: Effect[]; vx: number; vy: number; damage: number; life: number; origin: Point; aim: Point; target?: number; remaining: number; hits: number[]; bounces: number; returning: boolean; airborne: boolean; lingered: boolean; phase: 'flight' | 'linger'; timer: number; trail: number; leaf: boolean; triggered: boolean; initialRange: number; travelled: number; directHits: number; blocked: number[] }
export interface Field extends Point { owner: number; province: number | null; kind: 'burn' | 'frost'; weapon: Weapon; life: number; radius: number; damage: number }
export interface PendingEffect extends Point { owner: number; province: number | null; weapon: Weapon; kind: Payload; remaining: number }
export interface VisualEffect extends Point { kind: 'hit' | 'fort-hit' | 'blast' | 'death' | 'flame' | 'arc' | 'frost'; life: number; max: number; angle: number; target?: Point; radius?: number; }
export interface Casualty extends Point { id: number; owner: number; weapon: Weapon | null; angle: number; force: number; time: number }
export interface Battle { province: number; fighters: Fighter[]; reserve: Soldier[]; nextDeploy: number[]; models: boolean; shots: number; losses: number[] }
export interface Settings { seed: number; count: number; enemies: number; difficulty: 'easy' | 'normal' | 'hard'; training?: boolean; tutorial?: boolean; multiplayer?: boolean }
export interface World {
  settings: Settings; time: number; tick: number; nextId: number; rng: number;
  provinces: Province[]; factions: Faction[]; routes: Route[]; shipments: Shipment[]; battles: Battle[]; flows: SupplyFlow[];
  casualties: Casualty[];
  projectiles: Projectile[]; fields: Field[]; pendingEffects: PendingEffect[]; visuals: VisualEffect[];
  winner: number | null; stats: { kills: number; losses: number }[]; result: { troops: number; land: number }[] | null;
}
export const STEP = 1 / 30;
export const CAPACITY = 60;
export const BATTLE_CAP = 240;
export const FACTION_COLORS = [0x208a8c, 0xd56f63, 0xb49742, 0x8879a4, 0x658a4d, 0xb96693];
export const BUILDING_NAMES: Record<NonNullable<Building>, string> = { hq: '总部兵营', barracks: '兵营', launcherWorks: '发射器工坊', attachmentWorks: '配件工厂', ammoWorks: '弹药工厂', chipWorks: '战术芯片工厂', armorWorks: '护甲工厂', researchLab: '研究室', mine: '金矿' };

export const FORT = { x: 560, y: 300, radius: 75 };

export const BUILDING_HP = 3000;
export const BUILDING_WORK_SECONDS = 4;
export const BUILDING_COST = { barracks: 140, launcherWorks: 110, ammoWorks: 140, attachmentWorks: 140, chipWorks: 160, armorWorks: 160, mine: 160, researchLab: 220 } as const;
