import { ARMORS, PREPARATION, WEAPONS } from '../content/equipment.ts';
import type { Item, Loadout } from '../content/equipment.ts';
import { TECH, TECHNOLOGIES, HEALTH_BONUS, HASTE_BONUS, MOBILITY_BONUS } from '../content/research.ts';
import type { ResearchBranch } from '../content/research.ts';
import type { World, Soldier, Fighter } from './types.ts';
import { STEP } from './types.ts';
import { allTroops } from './world.ts';

export const researchLevel = (w: World, owner: number, branch: ResearchBranch) => [3, 2, 1].find(n => w.factions[owner].research.includes(`${branch}${n}`)) ?? 0;
export const unlocked = (w: World, owner: number, item: Item) => w.settings.training || !TECHNOLOGIES.some(t => t.unlock?.includes(item) && !w.factions[owner].research.includes(t.id));
export const maxHealth = (w: World, s: Loadout & { owner: number }) => (s.weapon === 'hilt' ? 400 : 200) * (1 + HEALTH_BONUS[researchLevel(w, s.owner, 'health')]);
export const armorValue = (s: Loadout, melee: boolean) => { const armor = melee ? s.meleeArmor : s.rangedArmor; return armor ? ARMORS[armor].value : 0; };
export const attackInterval = (w: World, s: Loadout & { owner: number }) => (WEAPONS[s.weapon!].interval + s.effects.reduce((sum, e) => sum + PREPARATION[e], 0)) / (1 + HASTE_BONUS[researchLevel(w, s.owner, 'haste')]);
export const moveSpeed = (w: World, s: Soldier) => s.frozen! > 0 ? 0 : (s.weapon === 'hilt' ? 16 : 12) * (1 + MOBILITY_BONUS[researchLevel(w, s.owner, 'mobility')]) * (1 - (s.rangedArmor ? ARMORS[s.rangedArmor].weight : 0) - (s.meleeArmor ? ARMORS[s.meleeArmor].weight : 0)) * (1 - (s.chill ?? 0) * .003);
export function researchError(w: World, province: number, id: string, owner: number): string | null {
  const p = w.provinces[province], t = TECH[id], f = w.factions[owner];
  if (p.owner !== owner || p.building !== 'researchLab' || !t) return '需要己方研究室';
  if (p.work?.type === 'build') return '研究室建设中';
  if (p.research) return '研究室忙碌';
  if (f.research.includes(id)) return '已完成';
  if (w.provinces.some(q => q.owner === owner && q.research?.id === id)) return '研发中';
  if (t.prerequisite && !f.research.includes(t.prerequisite)) return `需要${TECH[t.prerequisite].name}`;
  if (p.hp <= 0) return '研究室瘫痪';
  if (!w.settings.training && f.gold < t.cost) return `需要 ${t.cost} 金`;
  return null;
}
export function startResearch(w: World, province: number, id: string, owner: number) {
  const error = researchError(w, province, id, owner); if (error) return error;
  if (!w.settings.training) w.factions[owner].gold -= TECH[id].cost;
  w.provinces[province].research = { id, elapsed: 0 }; return null;
}
export function cancelResearch(w: World, province: number, owner: number): string | null {
  const p = w.provinces[province];
  if (p.owner !== owner || !p.research) return '没有可取消的研发';
  if (!w.settings.training) w.factions[owner].gold += TECH[p.research.id].cost;
  p.research = undefined; return null;
}
function changeResearch(w: World, owner: number, change: () => void) {
  const troops = allTroops(w).filter(s => s.owner === owner), old = troops.map(s => ({ hp: maxHealth(w, s), interval: s.weapon ? attackInterval(w, s) : 1 }));
  change();
  troops.forEach((s, i) => {
    s.hp *= maxHealth(w, s) / old[i].hp;
    const ratio = (s.weapon ? attackInterval(w, s) : 1) / old[i].interval;
    if ('cooldown' in s) (s as Fighter).cooldown *= ratio;
    if (s.artilleryCooldown !== undefined) s.artilleryCooldown *= ratio;
  });
}
export function stepResearch(w: World) {
  for (const p of w.provinces) if (p.research && p.owner >= 0 && p.hp > 0) {
    p.research.elapsed += STEP;
    if (p.research.elapsed + 1e-8 >= TECH[p.research.id].seconds) {
      const id = p.research.id;
      changeResearch(w, p.owner, () => w.factions[p.owner].research.push(id));
      p.research = undefined;
    }
  }
}
export function setTrialResearch(w: World, owner: number, branch: ResearchBranch, level: number) {
  if (!w.settings.training) return '仅限试验场';
  changeResearch(w, owner, () => { w.factions[owner].research = w.factions[owner].research.filter(id => TECH[id].branch !== branch); for (let i = 1; i <= level; i++) w.factions[owner].research.push(`${branch}${i}`); });
  return null;
}
