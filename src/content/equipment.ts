export const WEAPONS = {
  launcher: { name: '通用发射器', range: 324, damage: 16, interval: .8, speed: 440 },
  hilt: { name: '剑柄', range: 48, damage: 28, interval: .75, speed: 0 },
} as const;
export const AMMO = { round: { name: '实体弹' }, beam: { name: '射束' }, blade: { name: '剑刃' } } as const;
export const EFFECTS = {
  blast: { name: '炸药', description: '远程在末端爆炸；近战只对命中者追加伤害' },
  arc: { name: '电弧', description: '远程弹体沿途放电；近战追加单兵伤害' },
  burn: { name: '燃烧剂', description: '远程命中留下火区；近战追加单兵伤害' },
  frost: { name: '冷凝剂', description: '远程积累减速与冻结；近战追加单兵伤害' },
  pierce: { name: '穿透', description: '最多命中三人，后续命中威力衰减' },
  bounce: { name: '弹跳', description: '命中后转向附近新目标，最多两次' },
  split: { name: '分裂', description: '将弹体或附加效果分成三份，不递归分裂' },
  return: { name: '返航', description: '去程结束后返回，回程可再次命中' },
  homing: { name: '追踪', description: '有限度地修正方向，追向目标' },
  linger: { name: '滞留', description: '末端停留两秒，继续接触攻击和放电' },
  trail: { name: '留痕', description: '沿途留下弱化的附加效果，需要效果配件' },
  delay: { name: '延时', description: '末端效果延后释放，需要炸药、燃烧或冷凝' },
  lob: { name: '抛射', description: '实体弹跨地块炮击；最小距离 65，近距离受敌压制时不能开火' },
} as const;
export type Weapon = keyof typeof WEAPONS;
export type Ammo = keyof typeof AMMO;
export type Effect = keyof typeof EFFECTS;
export type Item = Weapon | Ammo | Effect;
export const PAYLOADS: Effect[] = ['blast', 'arc', 'burn', 'frost'];
export const REMOTE_ONLY: Effect[] = ['bounce', 'split', 'return', 'homing', 'linger', 'trail', 'delay', 'lob'];
export const WORKSHOP_ITEMS = {
  launcherWorks: Object.keys(WEAPONS) as Item[],
  ammoWorks: Object.keys(AMMO) as Item[],
  attachmentWorks: Object.keys(EFFECTS) as Item[],
};
export type Workshop = keyof typeof WORKSHOP_ITEMS;
export const isWorkshop = (kind: string | null): kind is Workshop => kind !== null && kind in WORKSHOP_ITEMS;
export const ITEMS = [...Object.keys(WEAPONS), ...Object.keys(AMMO), ...Object.keys(EFFECTS)] as Item[];
export const itemName = (item: Item) => item in WEAPONS ? WEAPONS[item as Weapon].name : item in AMMO ? AMMO[item as Ammo].name : EFFECTS[item as Effect].name;
export interface Loadout { weapon: Weapon | null; ammo: Ammo | null; effects: Effect[] }
export function validateLoadout(s: Loadout): string | null {
  if (s.weapon === 'hilt' && s.ammo && s.ammo !== 'blade' || s.weapon && s.weapon !== 'hilt' && s.ammo === 'blade') return '剑柄需要剑刃，通用发射器需要远程弹药';
  if ((s.weapon === 'hilt' || s.ammo === 'blade') && s.effects.some(e => REMOTE_ONLY.includes(e))) return '近战行为配件仅支持穿透';
  if (s.ammo === 'beam' && s.effects.includes('lob')) return '抛射仅支持实体弹';
  if (s.weapon && s.ammo && s.effects.includes('trail') && !s.effects.some(e => PAYLOADS.includes(e))) return '留痕需要效果配件';
  if (s.weapon && s.ammo && s.effects.includes('delay') && !s.effects.some(e => ['blast', 'burn', 'frost'].includes(e))) return '延时需要末端效果';
  return null;
}
export function configuration(items: Item[]) {
  const unique = [...new Set(items)], weapons = unique.filter(i => i in WEAPONS) as Weapon[], ammo = unique.filter(i => i in AMMO) as Ammo[];
  const loadout: Loadout = { weapon: weapons[0] ?? null, ammo: ammo[0] ?? null, effects: unique.filter(i => i in EFFECTS).sort() as Effect[] };
  const error = weapons.length > 1 ? '发射器冲突' : ammo.length > 1 ? '弹药冲突' : validateLoadout(loadout);
  return { ...loadout, items: unique, error };
}
export const equipmentKey = (s: Loadout) => [s.weapon ?? '', s.ammo ?? '', ...[...s.effects].sort()].join(':');
export const equipmentName = (s: Loadout) => [s.weapon && itemName(s.weapon), s.ammo && itemName(s.ammo), ...s.effects.map(itemName)].filter(Boolean).join(' · ');
export const canFight = (s: Loadout) => !!s.weapon && !!s.ammo && !validateLoadout(s);
export function canEquip(s: Loadout & { recruit?: boolean }, item: Item) {
  if (!s.recruit) return false;
  if (item in WEAPONS) return !s.weapon && !validateLoadout({ ...s, weapon: item as Weapon });
  if (item in AMMO) return !s.ammo && !validateLoadout({ ...s, ammo: item as Ammo });
  return !s.effects.includes(item as Effect) && !validateLoadout({ ...s, effects: [...s.effects, item as Effect] });
}
export const unitKey = (s: Loadout & { recruit?: boolean }) => `${s.recruit ? 'recruit' : 'army'}:${canFight(s) ? equipmentKey(s) : 'unarmed'}`;
export const ARTILLERY_MIN = 65;
export const ARTILLERY_MAX = 330;
