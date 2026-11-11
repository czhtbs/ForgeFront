import { ARMORS, CHIPS, EFFECTS, PAYLOADS, PREPARATION, WEAPONS, itemName } from '../content/equipment.ts';
import type { Item, Armor, Chip, Effect, Payload } from '../content/equipment.ts';
import { EFFECT_VALUES, TECH, TECHNOLOGIES } from '../content/research.ts';
import type { Technology } from '../content/research.ts';
import type { Soldier, World } from '../sim/types.ts';
import { armorValue, attackInterval, maxHealth, moveSpeed, researchError, researchLevel } from '../sim/research.ts';

export const escapeHTML = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const icon = (id: string) => `<img src="assets/icons/${id}.svg" alt="" draggable="false">`;
export function itemDetails(w: World, owner: number, item: Item): string {
  if (item in ARMORS) { const a = ARMORS[item as Armor]; return `${a.slot === 'rangedArmor' ? '远程' : '近战'}护甲 ${a.value} · 移速 −${a.weight * 100}%`; }
  if (item in CHIPS) return CHIPS[item as Chip].description;
  if (item === 'rifle' || item === 'sword') { const s = WEAPONS[item === 'rifle' ? 'launcher' : 'hilt']; return `基础伤害 ${s.damage} · 射程 ${s.range * .12} · 基础间隔 ${s.interval} 秒`; }
  const level = PAYLOADS.includes(item as Effect) ? researchLevel(w, owner, item as Payload) : 0;
  const value = item === 'blast' ? `伤害 ${EFFECT_VALUES.blast.damage[level]} · 半径 ${EFFECT_VALUES.blast.radius[level]}`
    : item === 'burn' ? `每 0.25 秒 ${EFFECT_VALUES.burn.damage[level]} 伤害 · 半径 ${EFFECT_VALUES.burn.radius[level]} · 持续 4 秒`
    : item === 'frost' ? `${100 / EFFECT_VALUES.frost.cold[level]} 秒积寒 · 冻结 ${EFFECT_VALUES.frost.duration[level]} 秒 · 半径 ${EFFECT_VALUES.frost.radius[level]}`
    : item === 'arc' ? `${EFFECT_VALUES.arc.damage[level]} 无视护甲伤害 · ${EFFECT_VALUES.arc.targets[level]} 人 · 半径 ${EFFECT_VALUES.arc.radius[level]}` : EFFECTS[item as Effect].description;
  return `${value} · 准备 +${PREPARATION[item as Effect]} 秒`;
}
export function soldierPortrait(s: Soldier, color: number) {
  const team = `#${color.toString(16).padStart(6, '0')}`, ranged = s.rangedArmor && ARMORS[s.rangedArmor].value, melee = s.meleeArmor && ARMORS[s.meleeArmor].value;
  return `<svg class="soldier-portrait" viewBox="0 0 100 146" role="img" aria-label="${s.weapon === 'hilt' ? '剑兵' : '步枪兵'}装备正视图"><ellipse cx="50" cy="135" rx="32" ry="6" fill="#bdcbbb" opacity=".4"/><g stroke="#405a54" stroke-width="2.5" stroke-linejoin="round"><path d="M30 89h40v33H54v-20h-8v20H30z" fill="${team}"/><path d="M27 120h19v13H25v-9zm27 0h19l3 4v9H54z" fill="#51645a"/><path d="M29 55h42l8 16-8 26H29l-8-26z" fill="${team}"/><path d="M21 62h13v29H18V72zm45 0h13l3 10v19H66z" fill="#d9bd94"/><path d="M31 18h38v29L59 57H41L31 47z" fill="#e6cfa8"/><path d="M27 17 36 8h28l9 9v11H27z" fill="${team}"/><path d="M33 35h5m24 0h5M46 47h8" fill="none" stroke-width="3"/>${ranged ? `<path d="M31 58h38v32H31z" fill="#9bb1ad"/><path d="M35 64h30v7H35zm0 12h30v7H35z" fill="#6e8d8d"/>${ranged >= 20 ? '<path d="M25 57h9v26h-9m41-26h9v26h-9" fill="#8ca3a1"/>' : ''}${ranged >= 30 ? '<path d="M32 91h36v12H32z" fill="#91a6a3"/>' : ''}` : '<path d="M35 72h10v10H35m20-10h10v10H55" fill="#d6c38c"/>'}${melee ? `<path d="M26 15 36 6h28l10 9v13H26z" fill="#b9ae89"/><path d="M19 56h15v13H17zm47 0h15l2 13H66z" fill="#b9ae89"/>${melee >= 20 ? '<path d="M28 28h9v18h-9m35-18h9v18h-9" fill="#9d987c"/>' : ''}${melee >= 30 ? '<path d="M37 28h26v10H37z" fill="#7e897e"/><path d="M40 32h20" stroke="#e0c586"/>' : ''}` : ''}${s.weapon === 'hilt' ? '<path d="M80 45 85 38l5 7v54H80z" fill="#c9d9d4"/><path d="M75 99h20v5H75zm8 5h5v17h-5z" fill="#c2a365"/><path d="M79 106h11v9H79" fill="#e6cfa8"/>' : '<path d="M17 78h14v13H17zm14 2h47v8H31zm47 1h15v4H78z" fill="#596e70"/><path d="M34 88h8v16h-8zm24 0h8v11h-8z" fill="#7a8b83"/><path d="M24 86h10v8H24m34-8h10v8H58" fill="#e6cfa8"/>'}</g></svg>`;
}
export function unitPanel(w: World, soldiers: Soldier[]) {
  const s = soldiers[0], hp = String(Math.round(maxHealth(w, s)));
  const stat = (id: string, name: string, value: string) => `<div class="unit-stat">${icon(id)}<span>${name}<b>${value}</b></span></div>`;
  const slot = (name: string, item?: Item) => `<div class="gear-slot" tabindex="0" data-tooltip="${escapeHTML(item ? itemDetails(w, s.owner, item) : '未装备')}">${icon(item ?? 'empty')}<span><small>${name}</small><b>${item ? itemName(item) : '空'}</b></span></div>`;
  const payload = s.effects.find(e => PAYLOADS.includes(e));
  return `<section class="unit-sheet"><div class="unit-sheet-heading"><b>${s.weapon === 'hilt' ? '剑兵' : '步枪兵'}</b><span style="color:#${w.factions[s.owner].color.toString(16).padStart(6, '0')}">${soldiers.length} 人</span></div><div class="unit-stats">${stat('health', '血量', hp)}${stat('attack', '攻击', '50')}${stat('rangedLight', '远程护甲', String(armorValue(s, false)))}${stat('meleeLight', '近战护甲', String(armorValue(s, true)))}${stat('haste', '攻击频率', (1 / attackInterval(w, s)).toFixed(2) + '/秒')}${stat('mobility', '移速', moveSpeed(w, s).toFixed(1))}</div><div class="paper-doll">${soldierPortrait(s, w.factions[s.owner].color)}<div class="gear-slots">${slot('远程防具', s.rangedArmor)}${slot('近战防具', s.meleeArmor)}${slot('武器', s.weapon === 'hilt' ? 'sword' : 'rifle')}${slot('附加效果', payload)}</div></div><div class="gear-heading">武器配件</div><div class="mod-slots">${s.effects.filter(e => !PAYLOADS.includes(e)).map(item => slot('', item)).join('') || slot('')}</div><div class="gear-heading">战术芯片</div>${slot('', s.chip)}</section>`;
}
export function researchPanel(w: World, province: number, tab: Technology['tab']) {
  const p = w.provinces[province], owner = p.owner, current = p.research && TECH[p.research.id];
  const tabs = [['effects', '附加效果'], ['equipment', '装备解锁'], ['general', '通用强化']] as const;
  let html = `<div class="research-tabs" role="tablist" aria-label="科技分类">${tabs.map(([id, name]) => `<button role="tab" aria-selected="${id === tab}" class="${id === tab ? 'chosen' : ''}" data-action="research-tab" data-id="${id}">${name}</button>`).join('')}</div>`;
  if (current) html += `<div class="current-research">${icon(current.icon)}<b>${current.name}</b><span>${Math.floor(p.research!.elapsed / current.seconds * 100)}%</span></div><div class="meter" role="progressbar" aria-label="${current.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(p.research!.elapsed / current.seconds * 100)}"><i style="width:${p.research!.elapsed / current.seconds * 100}%"></i></div><button class="wide" data-action="cancel-research">取消研发</button>`;
  html += `<div class="research-grid" role="tabpanel">${TECHNOLOGIES.filter(t => t.tab === tab).map(t => {
    const done = w.factions[owner].research.includes(t.id), running = w.provinces.some(q => q.owner === owner && q.research?.id === t.id), error = researchError(w, province, t.id, owner);
    const details = `${t.benefit.replaceAll('；', '\n')}\n${t.cost} 金 · ${t.seconds} 秒${t.prerequisite ? '\n前置：' + TECH[t.prerequisite].name : ''}${error ? '\n' + error : ''}`;
    return `<button class="research-card ${done ? 'complete' : ''}" data-action="research" data-id="${t.id}" aria-disabled="${!!error}" data-tooltip="${escapeHTML(details)}">${icon(t.icon)}<b>${t.name}</b><span>${done ? '已完成' : running ? '研发中' : t.level ? ['Ⅰ', 'Ⅱ', 'Ⅲ'][t.level - 1] : '解锁'}</span></button>`;
  }).join('')}</div>`;
  return html;
}
