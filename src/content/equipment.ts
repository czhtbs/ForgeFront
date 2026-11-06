export const WEAPONS = {
  rifle: { name: '基础步枪', range: 450, damage: 9, interval: .85, speed: 440 },
  mg: { name: '机枪', range: 540, damage: 7, interval: .25, speed: 500 },
  sniper: { name: '狙击枪', range: 810, damage: 38, interval: 2.2, speed: 700 },
  rocket: { name: '火箭筒', range: 675, damage: 27, interval: 2.6, speed: 210 },
  flame: { name: '火焰喷射器', range: 225, damage: 6, interval: .2, speed: 300 },
} as const;
export const EFFECTS = { pierce: { name: '穿透' }, blast: { name: '爆炸' }, gas: { name: '毒气' }, split: { name: '分裂' } } as const;
export type Weapon = keyof typeof WEAPONS;
export type Effect = keyof typeof EFFECTS;
export type Item = Exclude<Weapon, 'rifle'> | Effect;
export const ITEMS = [...Object.keys(WEAPONS).filter(k => k !== 'rifle'), ...Object.keys(EFFECTS)] as Item[];
export const itemName = (item: Item) => item in WEAPONS ? WEAPONS[item as Weapon].name : EFFECTS[item as Effect].name;
export interface Loadout { weapon: Weapon; effects: Effect[] }
export function validateLoadout(loadout: Loadout): string | null {
  if (loadout.effects.includes('gas') && (loadout.weapon === 'flame' || loadout.effects.includes('blast'))) return '毒气与火焰 / 爆炸冲突';
  if (loadout.effects.includes('pierce') && loadout.effects.includes('split')) return '穿透与分裂冲突';
  return null;
}
export function configuration(items: Item[]) {
  const unique = [...new Set(items)];
  const weapons = unique.filter(i => i in WEAPONS) as Weapon[];
  const loadout: Loadout = { weapon: weapons[0] ?? 'rifle', effects: unique.filter(i => i in EFFECTS).sort() as Effect[] };
  const error = weapons.length > 1 ? `${weapons.map(w => WEAPONS[w].name).join('、')}：主武器冲突` : validateLoadout(loadout);
  return { ...loadout, items: unique, error };
}
export const equipmentKey = (s: Loadout) => [s.weapon, ...[...s.effects].sort()].join(':');
export const equipmentName = (s: Loadout) => [WEAPONS[s.weapon].name, ...s.effects.map(e => EFFECTS[e].name)].join(' · ');

export const canFight = (s: Loadout & { recruit?: boolean; equipped?: boolean }) => !s.recruit || !!s.equipped;
export const unitKey = (s: Loadout & { recruit?: boolean; equipped?: boolean }) => `${s.recruit ? 'recruit' : 'army'}:${canFight(s) ? equipmentKey(s) : 'unarmed'}`;
