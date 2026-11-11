export const WEAPONS = {
  launcher: { name: '通用发射器', range: 300, damage: 50, interval: .9, speed: 750 },
  hilt: { name: '剑柄', range: 50, damage: 50, interval: 1.1, speed: 0 },
} as const;
export const AMMO = { round: { name: '实体弹' }, blade: { name: '剑刃' } } as const;
export const LAUNCHERS = {
  rifle: { name: '步枪', weapon: 'launcher', ammo: 'round' },
  sword: { name: '剑', weapon: 'hilt', ammo: 'blade' },
} as const;
export const EFFECTS = {
  blast: { name: '炸药', description: '瞬间范围伤害，扣除来源对应护甲' },
  arc: { name: '电弧', description: '触发时电击附近敌人，无视护甲' },
  burn: { name: '燃烧', description: '留下燃烧区域，每跳独立扣甲' },
  frost: { name: '冰霜', description: '积累寒冷后冻结，不造成伤害' },
  pierce: { name: '穿透', description: '额外直击两人，伤害完整' },
  bounce: { name: '弹跳', description: '最多转向两次，寻找 18 距离内的新目标' },
  split: { name: '分裂', description: '主触发时生成三枚完整子弹，继承除分裂外的配件' },
  return: { name: '返航', description: '返回发射点，额外一次回程直击' },
  homing: { name: '追踪', description: '每秒最多转向 120°' },
  linger: { name: '滞留', description: '终点停留 2 秒，不重复主效果' },
  trail: { name: '留痕', description: '航程 20%、40%、60%、80% 各额外触发一次' },
  delay: { name: '延时', description: '主效果和留痕延后 0.8 秒释放' },
  lob: { name: '抛射', description: '射程 65–330，弹速 75，近敌压制' },
} as const;
export const CHIPS = {
  far: { name: '远距', description: '在射程 85%–95% 保持距离，后退速度为 75%' },
  near: { name: '近射', description: '接近至距离 12，途中可以射击' },
  spread: { name: '分火', description: '优先攻击较少友军瞄准的敌人' },
} as const;
export const ARMORS = {
  rangedLight: { name: '轻型远程防具', slot: 'rangedArmor', value: 10, weight: .05, seconds: 6 },
  rangedMedium: { name: '中型远程防具', slot: 'rangedArmor', value: 20, weight: .1, seconds: 12 },
  rangedHeavy: { name: '重型远程防具', slot: 'rangedArmor', value: 30, weight: .2, seconds: 20 },
  meleeLight: { name: '轻型近战防具', slot: 'meleeArmor', value: 10, weight: .05, seconds: 6 },
  meleeMedium: { name: '中型近战防具', slot: 'meleeArmor', value: 20, weight: .1, seconds: 12 },
  meleeHeavy: { name: '重型近战防具', slot: 'meleeArmor', value: 30, weight: .2, seconds: 20 },
} as const;
export type Weapon = keyof typeof WEAPONS;
export type Ammo = keyof typeof AMMO;
export type Effect = keyof typeof EFFECTS;
export type Launcher = keyof typeof LAUNCHERS;
export type Chip = keyof typeof CHIPS;
export type Armor = keyof typeof ARMORS;
export type Payload = 'blast' | 'arc' | 'burn' | 'frost';
export type Item = Launcher | Effect | Chip | Armor;
export const PAYLOADS: Effect[] = ['blast', 'arc', 'burn', 'frost'];
export const REMOTE_ONLY: Effect[] = ['bounce', 'split', 'return', 'homing', 'linger', 'trail', 'delay', 'lob'];
export const WORKSHOP_ITEMS = {
  launcherWorks: Object.keys(LAUNCHERS) as Item[],
  ammoWorks: [...PAYLOADS] as Item[],
  attachmentWorks: Object.keys(EFFECTS).filter(e => !PAYLOADS.includes(e as Effect)) as Item[],
  chipWorks: Object.keys(CHIPS) as Item[],
  armorWorks: Object.keys(ARMORS) as Item[],
};
export type Workshop = keyof typeof WORKSHOP_ITEMS;
export const isWorkshop = (kind: string | null): kind is Workshop => kind !== null && kind in WORKSHOP_ITEMS;
export const ITEMS = Object.values(WORKSHOP_ITEMS).flat();
const CATALOG = { ...LAUNCHERS, ...EFFECTS, ...CHIPS, ...ARMORS };
export const itemName = (item: Item) => CATALOG[item].name;
export const PREPARATION: Record<Effect, number> = { blast: .05, arc: .05, burn: .1, frost: .05, pierce: .05, bounce: .05, split: .1, return: .05, homing: .02, linger: .05, trail: .1, delay: 0, lob: .1 };
export const PRODUCTION: Record<Item, number> = { rifle: 4, sword: 4, blast: 6, arc: 8, burn: 6, frost: 6, pierce: 8, bounce: 8, split: 16, return: 10, homing: 6, linger: 10, trail: 16, delay: 4, lob: 12, far: 8, near: 8, spread: 8, rangedLight: 6, rangedMedium: 12, rangedHeavy: 20, meleeLight: 6, meleeMedium: 12, meleeHeavy: 20 };
export const workshopFor = (item: Item): Workshop => (Object.keys(WORKSHOP_ITEMS) as Workshop[]).find(k => WORKSHOP_ITEMS[k].includes(item))!;
export interface Loadout { weapon: Weapon | null; ammo: Ammo | null; effects: Effect[]; chip?: Chip; rangedArmor?: Armor; meleeArmor?: Armor }
export function validateLoadout(s: Loadout, allowPayloadConflict = false): string | null {
  if (s.weapon === 'hilt' && s.ammo && s.ammo !== 'blade' || s.weapon && s.weapon !== 'hilt' && s.ammo === 'blade') return '剑柄需要剑刃，通用发射器需要远程弹药';
  if ((s.weapon === 'hilt' || s.ammo === 'blade') && s.effects.some(e => REMOTE_ONLY.includes(e))) return '剑仅支持穿透配件';
  if ((s.weapon === 'hilt' || s.effects.includes('lob')) && (s.chip === 'far' || s.chip === 'near')) return '远距和近射仅支持普通步枪';
  if (s.weapon && s.ammo && s.effects.some(e => e === 'trail' || e === 'delay') && !s.effects.some(e => PAYLOADS.includes(e))) return '留痕与延时需要附加效果';
  if (!allowPayloadConflict && s.effects.filter(e => PAYLOADS.includes(e)).length > 1) return '弹药冲突 · 停工';
  return null;
}
export function configuration(items: Item[], allowPayloadConflict = false) {
  const unique = [...new Set(items)], weapons = unique.filter(i => i in LAUNCHERS) as Launcher[], base = LAUNCHERS[weapons[0]];
  const chips = unique.filter(i => i in CHIPS) as Chip[], armors = unique.filter(i => i in ARMORS) as Armor[];
  const ranged = armors.filter(i => ARMORS[i].slot === 'rangedArmor'), melee = armors.filter(i => ARMORS[i].slot === 'meleeArmor');
  const loadout: Loadout = { weapon: base?.weapon ?? null, ammo: base?.ammo ?? null, effects: unique.filter(i => i in EFFECTS).sort() as Effect[], chip: chips[0], rangedArmor: ranged[0], meleeArmor: melee[0] };
  const error = weapons.length > 1 ? '武器冲突' : chips.length > 1 ? '芯片冲突' : ranged.length > 1 || melee.length > 1 ? '防具槽冲突' : validateLoadout(loadout, allowPayloadConflict);
  return { ...loadout, items: unique, error };
}
export const equipmentKey = (s: Loadout) => [s.weapon ?? '', s.ammo ?? '', ...[...s.effects].sort(), s.chip ?? '', s.rangedArmor ?? '', s.meleeArmor ?? ''].join(':');
export const equipmentName = (s: Loadout) => [s.weapon && (s.weapon === 'hilt' ? '剑' : '步枪'), ...s.effects.map(itemName), s.chip && itemName(s.chip), s.rangedArmor && itemName(s.rangedArmor), s.meleeArmor && itemName(s.meleeArmor)].filter(Boolean).join(' · ');
export const canFight = (s: Loadout) => !!s.weapon && !!s.ammo && !validateLoadout(s);
export function canEquip(s: Loadout & { recruit?: boolean }, item: Item) {
  if (!s.recruit) return false;
  if (item in LAUNCHERS) return !s.weapon && !validateLoadout({ ...s, ...LAUNCHERS[item as Launcher] });
  if (item in CHIPS) return !s.chip && !validateLoadout({ ...s, chip: item as Chip });
  if (item in ARMORS) return !s[ARMORS[item as Armor].slot];
  return !s.effects.includes(item as Effect) && !validateLoadout({ ...s, effects: [...s.effects, item as Effect] });
}
export function equip(s: Loadout, item: Item) {
  if (item in LAUNCHERS) { const base = LAUNCHERS[item as Launcher]; s.weapon = base.weapon; s.ammo = base.ammo; }
  else if (item in CHIPS) s.chip = item as Chip;
  else if (item in ARMORS) s[ARMORS[item as Armor].slot] = item as Armor;
  else { s.effects.push(item as Effect); s.effects.sort(); }
}
export const unitKey = (s: Loadout & { recruit?: boolean }) => `${s.recruit ? 'recruit' : 'army'}:${canFight(s) ? equipmentKey(s) : 'unarmed'}`;
export const ARTILLERY_MIN = 65;
export const ARTILLERY_MAX = 330;
