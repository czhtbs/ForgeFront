import { configuration, unitKey, canFight, canEquip, WEAPONS } from '../content/equipment.ts';
import type { Effect, Item, Loadout, Weapon } from '../content/equipment.ts';
import { addBattle, stepBattle, queueReinforcements } from './combat.ts';
import { createMap, distance, inside, movementPath, routePath, shortestPath, mapBounds } from './map.ts';
import { CAPACITY, FACTION_COLORS, STEP, BATTLE_W, BATTLE_H, FORT } from './types.ts';
import type { Building, Province, Settings, Soldier, Waypoint, World, Shipment, Point } from './types.ts';
import { MOVE_SPEED, SOLDIER_SIZE, assignSlots, formation, fortPosition, moveSoldier, marchOffset, toWorld } from './spatial.ts';
import { runAI } from '../ai/strategy.ts';
export function message(w: World, text: string) { w.messages.unshift({ time: w.time, text }); w.messages.length = Math.min(40, w.messages.length); }
export function soldier(w: World, owner: number, weapon: Weapon = 'rifle'): Soldier { return { id: w.nextId++, owner, hp: 100, weapon, effects: [] }; }
export function createWorld(settings: Settings): World {
  const w: World = { settings, time: 0, tick: 0, nextId: 1, rng: settings.seed >>> 0, provinces: createMap(settings.count, settings.seed), factions: [], routes: [], shipments: [], battles: [], flows: [], casualties: [], messages: [], winner: null, stats: [], result: null };
  const occupied = new Set<number>();
  const bounds = mapBounds(w.provinces);
  for (let id = 0; id <= settings.enemies; id++) {
    const angles = [Math.PI * .85, -Math.PI * .15, -Math.PI * .65, Math.PI * .35];
    const target = { x: bounds.x + Math.cos(angles[id]) * bounds.width * .4, y: bounds.y + Math.sin(angles[id]) * bounds.height * .4 };
    const hq = w.provinces.filter(p => !occupied.has(p.id) && p.neighbors.some(n => !occupied.has(n))).sort((a, b) => distance(a, target) - distance(b, target))[0];
    const mine = w.provinces[hq.neighbors.find(n => !occupied.has(n))!];
    occupied.add(hq.id); occupied.add(mine.id);
    w.factions.push({ id, name: ['青岚军团', '赤岩军团', '金原军团', '紫杉军团'][id], color: FACTION_COLORS[id], gold: 350, hq: hq.id, alive: true, ai: id !== 0 && !settings.training, intent: '整备与扩张' });
    w.stats.push({ kills: 0, losses: 0 });
    hq.owner = id; hq.building = 'hq'; mine.owner = id; mine.building = 'mine';
    hq.troops = Array.from({ length: 40 }, () => soldier(w, id)); assignSlots(hq, hq.troops);
  }
  if (settings.training) for (const p of w.provinces) if (p.owner < 0) p.owner = 0;
  return w;
}
export function localTroops(w: World, id: number, owner?: number): Soldier[] {
  const p = w.provinces[id], b = w.battles.find(b => b.province === id);
  const troops = [...p.troops, ...p.mobile, ...(b ? [...b.fighters, ...b.reserve] : [])];
  return owner === undefined ? troops : troops.filter(s => s.owner === owner);
}
export function totalTroops(w: World, owner: number) {
  return w.provinces.reduce((n, p) => n + localTroops(w, p.id, owner).length, 0) + w.shipments.reduce((n, s) => n + s.troops.filter(t => t.owner === owner).length, 0);
}
export function configuredItems(w: World, id: number): Item[] {
  return [...new Set(w.routes.filter(r => r.to === id && r.owner === w.provinces[id].owner).map(r => w.provinces[r.from].owner === r.owner ? w.provinces[r.from].output : r.item))];
}
export function routeRate(w: World, from: number) {
  const p = w.provinces[from], count = w.routes.filter(r => r.from === from && r.owner === p.owner).length;
  return count ? p.level / 4 / count : 0;
}
export function productionState(w: World, id: number) {
  const p = w.provinces[id], config = configuration(configuredItems(w, id));
  const inputs: Partial<Record<Item, number>> = {};
  for (const f of w.flows) if (f.to === id && f.owner === p.owner && f.start <= w.tick && f.end > w.tick) inputs[f.item] = (inputs[f.item] ?? 0) + f.rate;
  const recruits = [...p.troops, ...p.mobile].filter(s => s.owner === p.owner && s.recruit);
  const pending = Object.fromEntries(config.items.map(item => [item, recruits.filter(s => canEquip(s, item)).length])) as Partial<Record<Item, number>>;
  const rate = config.error ? 0 : config.items.reduce((n, item) => n + (pending[item] ? inputs[item] ?? 0 : 0), 0);
  const count = localTroops(w, id, p.owner).length;
  const waiting = recruits.filter(s => config.items.some(item => canEquip(s, item))).length;
  const status = config.error ?? (rate > 0 ? '装配中' : waiting ? '缺供给' : config.weapon === 'rifle' ? '等待主武器' : '装配完成');
  return { ...config, inputs, pending, rate, count, waiting, status };
}
export function build(w: World, id: number, building: NonNullable<Building>, owner = 0): string | null {
  const p = w.provinces[id], f = w.factions[owner], cost = building === 'barracks' ? 140 : building === 'workshop' ? 110 : 160;
  if (p.owner !== owner || p.building || building === 'hq' || w.battles.some(b => b.province === id)) return '需要己方未交战的空地块';
  if (!w.settings.training && f.gold < cost) return `需要 ${cost} 黄金`;
  if (!w.settings.training) f.gold -= cost; p.building = building; p.level = 1; p.assembly = {};
  message(w, `${f.name}在 ${p.name} 开始建设生产设施`); return null;
}
export function upgrade(w: World, id: number, owner = 0): string | null {
  const p = w.provinces[id], cost = p.level * 100;
  if (p.owner !== owner || !p.building || p.level >= 5) return '该建筑无法升级';
  if (!w.settings.training && w.factions[owner].gold < cost) return `需要 ${cost} 黄金`;
  if (!w.settings.training) w.factions[owner].gold -= cost; p.level++; return null;
}
export function supplyConflict(w: World, from: number, to: number, item = w.provinces[from].output) {
  const inputs = w.routes.filter(r => r.to === to && r.from !== from && r.owner === w.provinces[to].owner).map(r => w.provinces[r.from].output);
  return configuration([...inputs, item]).error;
}
export function setFactoryOutput(w: World, from: number, item: Item, owner = 0): string | null {
  const p = w.provinces[from];
  if (p.owner !== owner || p.building !== 'workshop') return '请选择己方工坊';
  for (const route of w.routes.filter(r => r.from === from && r.owner === owner)) {
    const error = supplyConflict(w, from, route.to, item);
    if (error) return `${w.provinces[route.to].name}：${error}`;
  }
  p.output = item; return null;
}
export function connect(w: World, from: number, to: number, owner = 0): string | null {
  const a = w.provinces[from], b = w.provinces[to];
  if (a.owner !== owner || b.owner !== owner || a.building !== 'workshop' || !['hq', 'barracks'].includes(b.building ?? '')) return '请从己方工坊建筑拖到己方兵营建筑';
  if (w.routes.some(r => r.from === from && r.to === to && r.owner === owner)) return '该路线已存在';
  const conflict = supplyConflict(w, from, to); if (conflict) return conflict;
  const path = shortestPath(w.provinces, from, to, owner); if (!path.length) return '己方领土间没有连通路线';
  w.routes.push({ id: w.nextId++, owner, from, to, item: a.output, via: [], path, status: 'normal' }); return null;
}
export function reroute(w: World, id: number, via: Waypoint[], owner = 0): string | null {
  const route = w.routes.find(r => r.id === id); if (!route || route.owner !== owner) return '无法编辑该路线';
  const path = routePath(w.provinces, route.from, route.to, via.map(v => v.province), owner); if (!path.length) return '路径点必须在连通的己方领土内';
  route.via = via.map(v => ({ ...v })); route.path = path; return null;
}
export function disconnect(w: World, id: number, owner = 0) { w.routes = w.routes.filter(r => r.id !== id || r.owner !== owner); }
const cleanSoldier = (s: Soldier): Soldier => ({ id: s.id, owner: s.owner, hp: s.hp, weapon: s.weapon, effects: [...s.effects], recruit: s.recruit, equipped: s.equipped, position: s.position ? { ...s.position } : undefined, angle: s.angle });
function station(p: Province, troops: Soldier[]) { const room = Math.max(0, CAPACITY - p.troops.length); p.troops.push(...troops.slice(0, room)); p.mobile.push(...troops.slice(room)); assignSlots(p, [...p.troops, ...p.mobile]); }
function send(w: World, from: number, to: number, path: number[], troops: Soldier[], owner: number) {
  assignSlots(w.provinces[from], troops);
  const center = { x: troops.reduce((n, s) => n + s.position!.x, 0) / troops.length, y: troops.reduce((n, s) => n + s.position!.y, 0) / troops.length };
  const destination = w.provinces[path[1]], angle = Math.atan2(destination.y - center.y, destination.x - center.x);
  const forward = (s: Soldier) => (s.position!.x - center.x) * Math.cos(angle) + (s.position!.y - center.y) * Math.sin(angle);
  troops.sort((a, b) => forward(b) - forward(a));
  const lead = forward(troops[0]);
  troops.forEach((s, i) => { s.slot = undefined; s.marchSlot = i; });
  w.shipments.push({ id: w.nextId++, owner, from, to, path, leg: 0, x: center.x + Math.cos(angle) * lead, y: center.y + Math.sin(angle) * lead, troops });
}
export function dispatch(w: World, from: number, to: number, count = Infinity, owner = 0, group?: string, selected?: Set<number>): string | null {
  if (from === to || w.battles.some(b => b.province === from)) return '交战部队请拖向相邻己方地块撤退';
  const p = w.provinces[from]; assignSlots(p, [...p.troops, ...p.mobile]);
  const path = movementPath(w, from, to, owner);
  if (!path.length) return '没有可绕过敌军的通路';
  const chosen = [...p.mobile, ...p.troops].filter(s => s.owner === owner && canFight(s) && (!group || unitKey(s) === group) && (!selected || selected.has(s.id))).slice(0, count);
  if (!chosen.length) return '没有可调动的军队';
  const ids = new Set(chosen.map(s => s.id)); p.mobile = p.mobile.filter(s => !ids.has(s.id)); p.troops = p.troops.filter(s => !ids.has(s.id));
  for (const s of chosen) { s.recruit = false; s.equipped = true; }
  send(w, from, to, path, chosen, owner); return null;
}
export function retreat(w: World, province: number, destination: number, owner = 0, group?: string, selected?: Set<number>): string | null {
  const b = w.battles.find(b => b.province === province), p = w.provinces[destination];
  if (!b || p.owner !== owner || !w.provinces[province].neighbors.includes(destination)) return '撤退目标须为相邻己方地块';
  for (const f of b.fighters) f.position = toWorld(w.provinces[province], f);
  const chosen = [...b.fighters, ...b.reserve].filter(s => s.owner === owner && canFight(s) && (!group || unitKey(s) === group) && (!selected || selected.has(s.id)));
  if (!chosen.length) return '没有可撤退的军队';
  const ids = new Set(chosen.map(s => s.id)); b.fighters = b.fighters.filter(s => !ids.has(s.id)); b.reserve = b.reserve.filter(s => !ids.has(s.id));
  for (const s of chosen) { s.recruit = false; s.equipped = true; }
  send(w, province, destination, [province, destination], chosen.map(cleanSoldier), owner); return null;
}
export function allTroops(w: World): Soldier[] { return [...w.provinces.flatMap(p => [...p.troops, ...p.mobile]), ...w.battles.flatMap(b => [...b.fighters, ...b.reserve]), ...w.shipments.flatMap(s => s.troops)]; }
export const travelTime = (w: World, path: number[]) => path.slice(1).reduce((seconds, id, i) => seconds + distance(w.provinces[path[i]], w.provinces[id]) / MOVE_SPEED, 0);
function canPass(w: World, id: number, owner: number, target: number) {
  const p = w.provinces[id];
  return id === target || (p.owner === owner || p.owner < 0) && !w.battles.some(b => b.province === id && [...b.fighters, ...b.reserve].some(s => s.owner !== owner));
}
export function marchPath(w: World, s: Shipment, target: number) {
  const anchors = [...new Set([s.path[Math.max(0, s.leg)], s.path[s.leg + 1]])].filter(id => id !== undefined && canPass(w, id, s.owner, target));
  return anchors.map(id => ({ path: movementPath(w, id, target, s.owner), id })).filter(x => x.path.length)
    .sort((a, b) => distance(s, w.provinces[a.id]) + travelTime(w, a.path) * MOVE_SPEED - distance(s, w.provinces[b.id]) - travelTime(w, b.path) * MOVE_SPEED)[0]?.path ?? [];
}
export function redirect(w: World, id: number, target: number, selected?: Set<number>, owner = 0): string | null {
  const s = w.shipments.find(s => s.id === id && s.owner === owner); if (!s) return '这支军队已抵达';
  const path = marchPath(w, s, target); if (!path.length) return '没有可绕过敌军的通路';
  const chosen = s.troops.filter(t => !selected || selected.has(t.id)); if (!chosen.length) return '没有选中的军队';
  if (chosen.length === s.troops.length) { s.path = path; s.leg = -1; s.to = target; }
  else {
    const ids = new Set(chosen.map(t => t.id)); s.troops = s.troops.filter(t => !ids.has(t.id));
    w.shipments.push({ ...s, id: w.nextId++, path, leg: -1, to: target, troops: chosen });
  }
  return null;
}
export function orderUnits(w: World, ids: number[], target: number, owner = 0): string | null {
  const selected = new Set(ids), errors: string[] = [], marching = w.shipments.filter(s => s.owner === owner && s.troops.some(t => selected.has(t.id))).map(s => s.id);
  let orders = 0;
  for (const p of w.provinces) {
    if (p.id === target || !localTroops(w, p.id, owner).some(s => selected.has(s.id) && canFight(s))) continue;
    const error = w.battles.some(b => b.province === p.id) ? retreat(w, p.id, target, owner, undefined, selected) : dispatch(w, p.id, target, Infinity, owner, undefined, selected);
    if (error) errors.push(error); else orders++;
  }
  for (const id of marching) { const error = redirect(w, id, target, selected, owner); if (error) errors.push(error); else orders++; }
  return errors.length ? `${orders ? '部分军队已执行；' : ''}${[...new Set(errors)].join('；')}` : orders ? null : '没有可调动的已装备军队';
}
export function endMatch(w: World) { w.result ??= w.factions.map(f => ({ troops: allTroops(w).filter(s => s.owner === f.id && canFight(s)).length, land: w.provinces.filter(p => p.owner === f.id).length })); }
function defeat(w: World, owner: number) {
  const remaining = w.factions.filter(f => f.alive && f.id !== owner);
  if (!w.settings.training && (owner === 0 || remaining.length === 1)) { endMatch(w); w.winner = remaining[0].id; }
  w.factions[owner].alive = false;
  for (const p of w.provinces) { if (p.owner === owner) p.owner = -1; p.troops = p.troops.filter(s => s.owner !== owner); p.mobile = p.mobile.filter(s => s.owner !== owner); }
  for (const b of w.battles) { b.fighters = b.fighters.filter(s => s.owner !== owner); b.reserve = b.reserve.filter(s => s.owner !== owner); b.projectiles = b.projectiles.filter(s => s.owner !== owner); }
  w.shipments = w.shipments.filter(s => s.owner !== owner); w.routes = w.routes.filter(r => r.owner !== owner); w.flows = w.flows.filter(f => f.owner !== owner);
}
function logistics(w: World) {
  w.flows = w.flows.filter(f => f.end > w.tick);
  w.routes = w.routes.filter(r => w.provinces[r.from].owner === r.owner && w.provinces[r.to].owner === r.owner);
  for (const r of w.routes) {
    if (r.via.some(v => w.provinces[v.province].owner !== r.owner)) r.via = [];
    r.path = routePath(w.provinces, r.from, r.to, r.via.map(v => v.province), r.owner);
    if (!r.path.length) { r.status = 'cut'; continue; }
    const source = w.provinces[r.from]; r.item = source.output;
    const blocked = w.battles.some(b => b.province === r.from), contested = r.path.some(id => w.battles.some(b => b.province === id));
    r.status = blocked ? 'idle' : contested ? 'delayed' : 'normal';
    // One-second flow intervals model transport delay, not inventory; unused arrivals expire.
    if (!blocked && w.tick % 30 === 1) {
      const start = w.tick + (r.path.length - 1) * 90 * (contested ? 2 : 1);
      w.flows.push({ owner: r.owner, from: r.from, to: r.to, item: source.output, rate: routeRate(w, r.from), start, end: start + 30 });
    }
  }
  for (const s of [...w.shipments]) {
    let next = s.path[s.leg + 1];
    if (!canPass(w, next, s.owner, s.to)) {
      const path = marchPath(w, s, s.to);
      if (path.length) { s.path = path; s.leg = -1; next = path[0]; }
      else {
        // Return to the last reached province instead of teleporting past a newly blocked route.
        const home = s.path[Math.max(0, s.leg)]; s.path = [home]; s.leg = -1; s.to = home; next = home;
        message(w, '路线受阻，部队正在返回');
      }
    }
    const goal = w.provinces[next], gap = distance(s, goal), step = MOVE_SPEED * STEP;
    const angle = Math.atan2(goal.y - s.y, goal.x - s.x);
    if (gap > step) { s.x += (goal.x - s.x) / gap * step; s.y += (goal.y - s.y) / gap * step; }
    else { s.x = goal.x; s.y = goal.y; s.leg++; }
    for (const t of s.troops) {
      const offset = marchOffset(t.marchSlot!, angle);
      moveSoldier(t, { x: s.x + offset.x, y: s.y + offset.y }, step);
    }
    const p = w.provinces[s.to], contested = p.owner !== s.owner || w.battles.some(b => b.province === p.id);
    if (contested && inside(s, p.polygon)) {
      addBattle(w, p.id, s.troops, { x: s.x, y: s.y }); s.troops = []; continue;
    }
    if (s.leg < s.path.length - 1) continue;
    station(p, s.troops.map(cleanSoldier)); s.troops = [];
  }
  w.shipments = w.shipments.filter(s => s.troops.length);
}
function production(w: World) {
  for (const p of w.provinces) {
    if (p.owner < 0 || !w.factions[p.owner].alive || !p.building) continue;
    const battle = w.battles.find(b => b.province === p.id);
    if (p.building === 'mine') { if (!battle) w.factions[p.owner].gold += STEP * (3 + p.level); continue; }
    if (p.building === 'workshop') continue;
    if (!battle && p.mobile.length && p.troops.length < CAPACITY) p.troops.push(...p.mobile.splice(0, CAPACITY - p.troops.length));
    const count = localTroops(w, p.id, p.owner).length;
    if (count >= CAPACITY) p.recruitment = 0;
    else {
      p.recruitment += STEP * (1 + (p.level - 1) * .3) / 3;
      if (p.recruitment + 1e-9 >= 1) { p.recruitment = Math.max(0, p.recruitment - 1); const position = fortPosition(p); position.y += 14; p.troops.push({ ...soldier(w, p.owner), recruit: true, equipped: false, position, angle: Math.PI / 2 }); }
    }
    assignSlots(p, [...p.troops, ...p.mobile]);
    const state = productionState(w, p.id);
    for (const item of Object.keys(p.assembly) as Item[]) if (!state.items.includes(item)) delete p.assembly[item];
    if (state.error) { p.assembly = {}; continue; }
    const items = [...state.items].sort((a, b) => (state.inputs[b] ?? 0) - (state.inputs[a] ?? 0) || Number(b in WEAPONS) - Number(a in WEAPONS));
    for (const item of items) {
      const candidates = [...p.troops, ...p.mobile].filter(s => s.owner === p.owner && canEquip(s, item))
        .sort((a, b) => b.effects.length + Number(!!b.equipped) - a.effects.length - Number(!!a.equipped) || a.id - b.id);
      if (!candidates.length || !state.inputs[item]) { p.assembly[item] = 0; continue; }
      const progress = (p.assembly[item] ?? 0) + STEP * state.inputs[item]!, amount = Math.min(candidates.length, Math.floor(progress + 1e-9));
      for (const unit of candidates.slice(0, amount)) {
        if (item in WEAPONS) { unit.weapon = item as Weapon; unit.equipped = true; }
        else { unit.effects.push(item as Effect); unit.effects.sort(); }
      }
      p.assembly[item] = amount === candidates.length ? 0 : Math.max(0, progress - amount);
    }
    if (battle) {
      const ready = [...p.troops, ...p.mobile].filter(s => s.owner === p.owner && canFight(s));
      const ids = new Set(ready.map(s => s.id)); p.troops = p.troops.filter(s => !ids.has(s.id)); p.mobile = p.mobile.filter(s => !ids.has(s.id)); queueReinforcements(w, battle, ready);
    }

  }
}
export function stepWorld(w: World) {
  if (w.winner !== null) return;
  w.tick++; w.time = w.tick * STEP;
  w.casualties = w.casualties.filter(c => w.time - c.time < 5);
  logistics(w); production(w);
  for (const p of w.provinces) {
    const troops = [...p.troops, ...p.mobile]; assignSlots(p, troops);
    const slots = formation(p, Math.max(0, ...troops.map(s => s.slot! + 1)));
    for (const s of troops) moveSoldier(s, slots[s.slot!], MOVE_SPEED * STEP);
  }
  for (const b of [...w.battles]) {
    stepBattle(w, b);
    const p = w.provinces[b.province];
    if (p.hp <= 0) {
      const old = p.owner, owner = p.capturedBy, hq = p.building === 'hq';
      p.owner = owner; p.hp = 1000; b.models = false;
      w.routes = w.routes.filter(r => r.from !== p.id && r.to !== p.id); p.assembly = {}; p.recruitment = 0;
      for (const s of [...p.troops, ...p.mobile]) if (s.recruit && !s.equipped) s.owner = owner;
      if (hq) p.building = 'barracks';
      for (const f of b.fighters) { f.target = undefined; f.targetOwner = undefined; }
      if (hq && old >= 0) defeat(w, old);
    }
    const all = [...b.fighters, ...b.reserve];
    if (!all.length || all.every(s => s.owner === p.owner)) {
      station(p, all.filter(s => w.factions[s.owner].alive).map(cleanSoldier));
      w.battles = w.battles.filter(x => x !== b);
    }
    if (w.winner !== null) break;
  }
  for (const p of w.provinces) {
    const attacking = w.battles.find(b => b.province === p.id)?.fighters.some(f => f.target === -1 && f.targetOwner === p.owner && distance(f, FORT) <= WEAPONS[f.weapon].range + FORT.radius);
    if (!attacking && w.time - p.lastHit > 1) p.hp = Math.min(1000, p.hp + STEP * 50);
  }
  const aiInterval = w.settings.difficulty === 'easy' ? 240 : w.settings.difficulty === 'hard' ? 90 : 150;
  if (w.winner === null && w.tick % aiInterval === 0) for (const f of w.factions) if (f.ai && f.alive) runAI(w, f.id);
}
export function trainingBattle(w: World, loadout: Loadout, amount = 40) {
  const target = w.factions[1].hq;
  w.battles = []; w.shipments = []; w.casualties = []; w.winner = null; w.result = null; w.stats.forEach(s => { s.kills = 0; s.losses = 0; });
  const p = w.provinces[target]; p.owner = 1; p.building = null; p.hp = 1000; p.troops = []; p.mobile = [];
  const allies = Array.from({ length: amount }, () => ({ ...soldier(w, 0, loadout.weapon), effects: [...loadout.effects] }));
  const enemies = Array.from({ length: amount }, () => soldier(w, 1, 'mg'));
  const positions = formation(p, amount * 2).sort((a, b) => a.x - b.x || a.y - b.y);
  for (const [units, direction] of [[allies, -1], [enemies, 1]] as const) units.forEach((unit, i) => {
    unit.position = { ...positions[i + (direction === 1 ? amount : 0)] };
    unit.angle = direction === -1 ? 0 : Math.PI;
  });
  addBattle(w, target, [...allies, ...enemies]); return target;
}
