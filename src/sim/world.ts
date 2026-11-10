import { sin, cos, atan2 } from './math.ts';
import { configuration, unitKey, canFight, canEquip, WEAPONS, LAUNCHERS, WORKSHOP_ITEMS, isWorkshop, ARTILLERY_MAX } from '../content/equipment.ts';
import type { Effect, Item, Loadout, Weapon, Ammo, Launcher } from '../content/equipment.ts';
import { addBattle, stepBattle, queueReinforcements } from './combat.ts';
import { createMap, distance, inside, movementPath, routePath, shortestPath, mapBounds, coastalCells } from './map.ts';
import { CAPACITY, FACTION_COLORS, STEP, FORT } from './types.ts';
import type { Building, Province, Settings, Soldier, Waypoint, World, Shipment, Point, Route, ArtilleryOrder } from './types.ts';
import { MOVE_SPEED, assignSlots, formation, fortPosition, moveSoldier, marchOffset, toWorld, troopCenter } from './spatial.ts';
import { artilleryAim, artilleryError, attackTargets, stepArtillery, stepAttacks, resolveDeaths } from './attacks.ts';
export function soldier(w: World, owner: number, weapon: Weapon = 'launcher', ammo: Ammo = weapon === 'hilt' ? 'blade' : 'round'): Soldier { return { id: w.nextId++, owner, hp: 100, weapon, ammo, effects: [] }; }
export function createWorld(settings: Settings): World {
  const w: World = { settings, time: 0, tick: 0, nextId: 1, rng: settings.seed >>> 0, provinces: createMap(settings.count, settings.seed), factions: [], routes: [], shipments: [], battles: [], flows: [], casualties: [], projectiles: [], fields: [], visuals: [], winner: null, stats: [], result: null };
  const occupied = new Set<number>();
  const bounds = mapBounds(w.provinces), coast = coastalCells(w.provinces);
  for (let id = 0; id <= settings.enemies; id++) {
    const angle = Math.PI * .85 + id * Math.PI * 2 / (settings.enemies + 1);
    const target = { x: bounds.x + cos(angle) * bounds.width * .24, y: bounds.y + sin(angle) * bounds.height * .24 };
    const hq = w.provinces.filter(p => !occupied.has(p.id) && p.neighbors.some(n => !occupied.has(n))).sort((a, b) => Number(coast.has(a.id)) - Number(coast.has(b.id)) || distance(a, target) - distance(b, target))[0];
    const mine = w.provinces[hq.neighbors.find(n => !occupied.has(n))!];
    occupied.add(hq.id); occupied.add(mine.id);
    w.factions.push({ id, name: id === 0 ? '玩家' : `AI ${id}`, color: FACTION_COLORS[id], gold: 350, hq: hq.id, alive: true, ai: id !== 0 && !settings.training });
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
function supplySources(w: World, id: number, routes: Pick<Route, 'from' | 'to' | 'owner'>[] = w.routes) {
  const pending = new Set([id]), sources = new Set<Province>(), owner = w.provinces[id].owner;
  for (const target of pending) for (const r of routes) {
    if (r.to !== target || r.owner !== owner || w.provinces[r.from].owner !== owner || w.provinces[r.to].owner !== owner) continue;
    const p = w.provinces[r.from];
    if (isWorkshop(p.building)) sources.add(p); else pending.add(p.id);
  }
  return [...sources];
}
export const configuredItems = (w: World, id: number): Item[] => [...new Set(supplySources(w, id).map(p => p.output))];
const outgoingRoutes = (w: World, id: number) => w.routes.filter(r => r.from === id && r.owner === w.provinces[id].owner && w.provinces[r.to].owner === r.owner);
function arrivingEquipment(w: World, id: number) {
  const inputs: Partial<Record<Item, number>> = {};
  for (const f of w.flows) if (f.to === id && f.owner === w.provinces[id].owner && f.start <= w.tick && f.end > w.tick) inputs[f.item] = (inputs[f.item] ?? 0) + f.rate;
  return inputs;
}
const reservedTroops = (w: World, id: number) => localTroops(w, id, w.provinces[id].owner).length + w.shipments.filter(s => s.transferRoute !== undefined && s.to === id && s.owner === w.provinces[id].owner).reduce((n, s) => n + s.troops.length, 0);
export function routeRate(w: World, from: number) {
  const p = w.provinces[from], count = w.routes.filter(r => r.from === from && r.owner === p.owner).length;
  return count ? p.level / 4 / count : 0;
}
export function productionState(w: World, id: number) {
  const p = w.provinces[id], config = configuration(configuredItems(w, id));
  const inputs = arrivingEquipment(w, id), forwarding = outgoingRoutes(w, id).length > 0;
  const recruits = [...p.troops, ...p.mobile].filter(s => s.owner === p.owner && s.recruit);
  const pending = Object.fromEntries(config.items.map(item => [item, recruits.filter(s => canEquip(s, item)).length])) as Partial<Record<Item, number>>;
  const rate = config.error || forwarding ? 0 : config.items.reduce((n, item) => n + (pending[item] ? inputs[item] ?? 0 : 0), 0);
  const count = localTroops(w, id, p.owner).length;
  const waiting = recruits.filter(s => config.items.some(item => canEquip(s, item))).length;
  const status = config.error ?? (p.hp <= 0 ? '建筑瘫痪' : forwarding ? '中转中 · 停止本地装配' : !config.weapon ? '等待武器供给' : rate > 0 ? '装配中' : waiting ? '缺供给' : '装配完成');
  return { ...config, inputs, pending, rate, count, incoming: reservedTroops(w, id) - count, waiting, forwarding, status };
}
export function build(w: World, id: number, building: NonNullable<Building>, owner = 0): string | null {
  const p = w.provinces[id], f = w.factions[owner], cost = building === 'barracks' ? 140 : isWorkshop(building) ? 110 : 160;
  if (p.owner !== owner || p.building || building === 'hq' || w.battles.some(b => b.province === id)) return '需要己方未交战的空地块';
  if (!w.settings.training && f.gold < cost) return `需要 ${cost} 黄金`;
  if (!w.settings.training) f.gold -= cost; p.building = building; p.level = 1; p.assembly = {};
  if (isWorkshop(building)) p.output = WORKSHOP_ITEMS[building][0];
  return null;
}
export function upgrade(w: World, id: number, owner = 0): string | null {
  const p = w.provinces[id], cost = p.level * 100;
  if (p.owner !== owner || !p.building || p.level >= 5) return '该建筑无法升级';
  if (!w.settings.training && w.factions[owner].gold < cost) return `需要 ${cost} 黄金`;
  if (!w.settings.training) w.factions[owner].gold -= cost; p.level++; return null;
}
export function supplyConflict(w: World, from: number, to: number, item = w.provinces[from].output) {
  const owner = w.provinces[from].owner, targets = new Set([to]);
  for (const id of targets) for (const r of outgoingRoutes(w, id)) targets.add(r.to);
  if (targets.has(from)) return '兵营运输不能形成循环';
  const routes = [...w.routes, { from, to, owner }];
  for (const id of targets) {
    const items = supplySources(w, id, routes).map(p => p.id === from ? item : p.output);
    const error = configuration(items).error;
    if (error) return `${w.provinces[id].name}：${error}`;
  }
  return null;
}
export function setFactoryOutput(w: World, from: number, item: Item, owner = 0): string | null {
  const p = w.provinces[from];
  if (p.owner !== owner || !isWorkshop(p.building)) return '请选择己方工坊';
  if (!WORKSHOP_ITEMS[p.building].includes(item)) return '该工坊不能生产此类装备';
  for (const route of w.routes.filter(r => r.from === from && r.owner === owner)) {
    const error = supplyConflict(w, from, route.to, item);
    if (error) return error;
  }
  p.output = item; return null;
}
export function connect(w: World, from: number, to: number, owner = 0): string | null {
  const a = w.provinces[from], b = w.provinces[to];
  if (a.owner !== owner || b.owner !== owner || !isWorkshop(a.building) && !['hq', 'barracks'].includes(a.building ?? '') || !['hq', 'barracks'].includes(b.building ?? '')) return '请从己方工坊或兵营拖到己方兵营';
  if (w.routes.some(r => r.from === from && r.to === to && r.owner === owner)) return '该路线已存在';
  const conflict = supplyConflict(w, from, to); if (conflict) return conflict;
  const path = shortestPath(w.provinces, from, to, owner); if (!path.length) return '己方领土间没有连通路线';
  w.routes.push({ id: w.nextId++, owner, from, to, item: isWorkshop(a.building) ? a.output : 'recruits', via: [], path, status: 'normal' });
  for (const s of [...a.troops, ...a.mobile]) s.transferRoute = undefined;
  a.transferCursor = 0; return null;
}
export function reroute(w: World, id: number, via: Waypoint[], owner = 0): string | null {
  const route = w.routes.find(r => r.id === id); if (!route || route.owner !== owner) return '无法编辑该路线';
  const path = routePath(w.provinces, route.from, route.to, via.map(v => v.province), owner); if (!path.length) return '路径点必须在连通的己方领土内';
  route.via = via.map(v => ({ ...v })); route.path = path; return null;
}
export function disconnect(w: World, id: number, owner = 0) { w.routes = w.routes.filter(r => r.id !== id || r.owner !== owner); }
const cleanSoldier = (s: Soldier): Soldier => ({ id: s.id, owner: s.owner, hp: s.hp, weapon: s.weapon, ammo: s.ammo, effects: [...s.effects], recruit: s.recruit, position: s.position ? { ...s.position } : undefined, angle: s.angle, chill: s.chill, frozen: s.frozen, bombard: s.bombard, artilleryCooldown: s.artilleryCooldown });
function station(p: Province, troops: Soldier[]) { const room = Math.max(0, CAPACITY - p.troops.length); p.troops.push(...troops.slice(0, room)); p.mobile.push(...troops.slice(room)); assignSlots(p, [...p.troops, ...p.mobile]); }
function send(w: World, from: number, to: number, path: number[], troops: Soldier[], owner: number, transferRoute?: number) {
  assignSlots(w.provinces[from], troops);
  const center = { x: troops.reduce((n, s) => n + s.position!.x, 0) / troops.length, y: troops.reduce((n, s) => n + s.position!.y, 0) / troops.length };
  const destination = w.provinces[path[1]], angle = atan2(destination.y - center.y, destination.x - center.x);
  const forward = (s: Soldier) => (s.position!.x - center.x) * cos(angle) + (s.position!.y - center.y) * sin(angle);
  troops.sort((a, b) => forward(b) - forward(a));
  const lead = forward(troops[0]);
  troops.forEach((s, i) => { s.slot = undefined; s.marchSlot = i; });
  w.shipments.push({ id: w.nextId++, owner, from, to, path: [...path], leg: 0, x: center.x + cos(angle) * lead, y: center.y + sin(angle) * lead, troops, transferRoute });
}
export function dispatch(w: World, from: number, to: number, count = Infinity, owner = 0, group?: string, selected?: Set<number>): string | null {
  if (from === to || w.battles.some(b => b.province === from)) return '交战部队请拖向相邻己方地块撤退';
  const p = w.provinces[from]; assignSlots(p, [...p.troops, ...p.mobile]);
  const path = movementPath(w, from, to, owner);
  if (!path.length) return '没有可绕过敌军的通路';
  const chosen = [...p.mobile, ...p.troops].filter(s => s.owner === owner && canFight(s) && (!group || unitKey(s) === group) && (!selected || selected.has(s.id))).slice(0, count);
  if (!chosen.length) return '没有可调动的军队';
  const ids = new Set(chosen.map(s => s.id)); p.mobile = p.mobile.filter(s => !ids.has(s.id)); p.troops = p.troops.filter(s => !ids.has(s.id));
  for (const s of chosen) { s.recruit = false; s.bombard = undefined; }
  send(w, from, to, path, chosen, owner); return null;
}
export function retreat(w: World, province: number, destination: number, owner = 0, group?: string, selected?: Set<number>): string | null {
  const b = w.battles.find(b => b.province === province), p = w.provinces[destination];
  if (!b || p.owner !== owner || !w.provinces[province].neighbors.includes(destination)) return '撤退目标须为相邻己方地块';
  for (const f of b.fighters) f.position = toWorld(w.provinces[province], f);
  const chosen = [...b.fighters, ...b.reserve].filter(s => s.owner === owner && canFight(s) && (!group || unitKey(s) === group) && (!selected || selected.has(s.id)));
  if (!chosen.length) return '没有可撤退的军队';
  const ids = new Set(chosen.map(s => s.id)); b.fighters = b.fighters.filter(s => !ids.has(s.id)); b.reserve = b.reserve.filter(s => !ids.has(s.id));
  for (const s of chosen) { s.recruit = false; s.bombard = undefined; }
  send(w, province, destination, [province, destination], chosen.map(cleanSoldier), owner); return null;
}
export function allTroops(w: World): Soldier[] { return [...w.provinces.flatMap(p => [...p.troops, ...p.mobile]), ...w.battles.flatMap(b => [...b.fighters, ...b.reserve]), ...w.shipments.flatMap(s => s.troops)]; }
export const travelTime = (w: World, path: number[]) => path.slice(1).reduce((seconds, id, i) => seconds + distance(w.provinces[path[i]], w.provinces[id]) / MOVE_SPEED, 0);
function canPass(w: World, id: number, owner: number, target: number) {
  const p = w.provinces[id];
  return id === target || (p.owner === owner || p.owner < 0) && !w.battles.some(b => b.province === id && [...b.fighters, ...b.reserve].some(s => s.owner !== owner));
}
export function marchPath(w: World, s: Shipment, target: number) {
  const current = w.provinces.find(p => inside(s, p.polygon))!;
  return movementPath(w, current.id, target, s.owner);
}
export function redirect(w: World, id: number, target: number, selected?: Set<number>, owner = 0): string | null {
  const s = w.shipments.find(s => s.id === id && s.owner === owner); if (!s) return '这支军队已抵达';
  const path = marchPath(w, s, target); if (!path.length) return '没有可绕过敌军的通路';
  const chosen = s.troops.filter(t => !selected || selected.has(t.id)); if (!chosen.length) return '没有选中的军队';
  chosen.forEach(t => t.bombard = undefined);
  const leg = path.length === 1 ? -1 : 0;
  if (chosen.length === s.troops.length) { s.path = path; s.leg = leg; s.to = target; }
  else {
    const ids = new Set(chosen.map(t => t.id)); s.troops = s.troops.filter(t => !ids.has(t.id));
    w.shipments.push({ ...s, id: w.nextId++, path, leg, to: target, troops: chosen });
  }
  return null;
}
export function orderUnits(w: World, ids: number[], target: number, owner = 0, point = fortPosition(w.provinces[target]), targetIds: number[] = []): string | null {
  const selected = new Set(ids), errors: string[] = []; let orders = 0;
  if (w.provinces[target].owner !== owner || targetIds.length) {
    const guns = allTroops(w).filter(s => selected.has(s.id) && s.owner === owner && s.effects.includes('lob'));
    if (guns.length) { const error = bombard(w, guns.map(s => s.id), target, point, owner, targetIds); if (error) errors.push(error); else orders++; guns.forEach(s => selected.delete(s.id)); }
  }
  const marching = w.shipments.filter(s => s.owner === owner && s.troops.some(t => selected.has(t.id))).map(s => s.id);
  for (const p of w.provinces) {
    if (p.id === target || !localTroops(w, p.id, owner).some(s => selected.has(s.id) && canFight(s))) continue;
    const error = w.battles.some(b => b.province === p.id) ? retreat(w, p.id, target, owner, undefined, selected) : dispatch(w, p.id, target, Infinity, owner, undefined, selected);
    if (error) errors.push(error); else orders++;
  }
  for (const id of marching) { const error = redirect(w, id, target, selected, owner); if (error) errors.push(error); else orders++; }
  return errors.length ? `${orders ? '部分军队已执行；' : ''}${[...new Set(errors)].join('；')}` : orders ? null : '没有可调动的已装备军队';
}
export function endMatch(w: World) { w.result ??= w.factions.map(f => ({ troops: allTroops(w).filter(s => s.owner === f.id && canFight(s)).length, land: w.provinces.filter(p => p.owner === f.id).length })); }
export function bombard(w: World, ids: number[], province: number, point: Point = fortPosition(w.provinces[province]), owner = 0, targetIds?: number[]): string | null {
  const selected = new Set(ids), targets = attackTargets(w), enemies = targetIds ?? targets.filter(t => t.unit.hp > 0 && t.unit.owner !== owner && distance(t.point, point) < 20).map(t => t.unit.id);
  const groups = [...w.provinces.map(p => ({ troops: localTroops(w, p.id), province: p.id })), ...w.shipments.map(s => ({ troops: s.troops, province: w.provinces.find(p => inside(s, p.polygon))!.id }))];
  let ordered = 0;
  for (const group of groups) {
    const troops = group.troops.filter(s => s.owner === owner && selected.has(s.id) && canFight(s) && s.effects.includes('lob')); if (!troops.length) continue;
    for (const s of troops) s.position = { ...targets.find(t => t.unit.id === s.id)!.point };
    const center = troopCenter(troops), far = distance(center, point) > ARTILLERY_MAX;
    if (!far) { const error = artilleryError(w, troops[0], point, center); if (error) return error; }
    if (far && !movementPath(w, group.province, province, owner).length) return '没有可接近目标的通路';
    const order: ArtilleryOrder = { id: w.nextId++, province, point: { ...point }, targets: [...enemies], center: far ? undefined : center };
    for (const s of troops) { s.bombard = order; s.recruit = false; ordered++; }
  }
  return ordered ? null : '没有装有抛射配件的军队';
}
function advanceArtillery(w: World) {
  for (const p of w.provinces) {
    const groups = new Map<ArtilleryOrder, Soldier[]>();
    for (const s of [...p.troops, ...p.mobile]) if (s.bombard) { const group = groups.get(s.bombard) ?? []; group.push(s); groups.set(s.bombard, group); }
    for (const [order, troops] of groups) {
      const aim = artilleryAim(w, order, troops[0].owner); if (!aim) { troops.forEach(s => { s.bombard = undefined; }); continue; }
      order.province = aim.province;
      if (distance(troopCenter(troops), aim.point) <= ARTILLERY_MAX) continue;
      const ids = new Set(troops.map(s => s.id));
      if (!dispatch(w, p.id, aim.province, Infinity, troops[0].owner, undefined, ids)) { order.center = undefined; for (const s of allTroops(w)) if (ids.has(s.id)) s.bombard = order; }
    }
  }
}
function defeat(w: World, owner: number) {
  const remaining = w.factions.filter(f => f.alive && f.id !== owner);
  if (!w.settings.training && (!w.settings.multiplayer && owner === 0 || remaining.length === 1)) { endMatch(w); w.winner = remaining[0].id; }
  w.factions[owner].alive = false;
  for (const p of w.provinces) { if (p.owner === owner) p.owner = -1; p.troops = p.troops.filter(s => s.owner !== owner); p.mobile = p.mobile.filter(s => s.owner !== owner); }
  for (const b of w.battles) { b.fighters = b.fighters.filter(s => s.owner !== owner); b.reserve = b.reserve.filter(s => s.owner !== owner); }
  w.shipments = w.shipments.filter(s => s.owner !== owner); w.routes = w.routes.filter(r => r.owner !== owner); w.flows = w.flows.filter(f => f.owner !== owner);
}
export function surrender(w: World, owner: number) { if (w.factions[owner].alive) defeat(w, owner); }
function transferRecruits(w: World) {
  for (const p of w.provinces) {
    if (p.building !== 'hq' && p.building !== 'barracks') continue;
    const routes = outgoingRoutes(w, p.id); if (!routes.length) continue;
    const recruits = [...p.troops, ...p.mobile].filter(s => s.owner === p.owner && s.recruit && !s.weapon).sort((a, b) => a.id - b.id);
    for (const s of recruits) if (!routes.some(r => r.id === s.transferRoute)) {
      s.transferRoute = routes[(p.transferCursor ?? 0) % routes.length].id;
      p.transferCursor = (p.transferCursor ?? 0) + 1;
    }
    for (const r of routes) {
      if (r.status === 'cut' || r.status === 'idle') continue;
      const room = Math.max(0, CAPACITY - reservedTroops(w, r.to));
      const chosen = recruits.filter(s => s.transferRoute === r.id).slice(0, room);
      if (!chosen.length) continue;
      const ids = new Set(chosen.map(s => s.id));
      p.troops = p.troops.filter(s => !ids.has(s.id)); p.mobile = p.mobile.filter(s => !ids.has(s.id));
      chosen.forEach(s => s.transferRoute = undefined);
      send(w, p.id, r.to, r.path, chosen, p.owner, r.id);
    }
  }
}
function receiveRecruits(w: World, s: Shipment) {
  const p = w.provinces[s.to];
  if (p.owner >= 0 && p.owner !== s.owner) { s.owner = p.owner; s.troops.forEach(t => t.owner = p.owner); }
  const room = Math.max(0, CAPACITY - localTroops(w, p.id, s.owner).length);
  station(p, s.troops.splice(0, room).map(cleanSoldier));
}
function logistics(w: World) {
  w.flows = w.flows.filter(f => f.end > w.tick);
  w.routes = w.routes.filter(r => w.provinces[r.from].owner === r.owner && w.provinces[r.to].owner === r.owner);
  for (const r of w.routes) {
    if (r.via.some(v => w.provinces[v.province].owner !== r.owner)) r.via = [];
    r.path = routePath(w.provinces, r.from, r.to, r.via.map(v => v.province), r.owner);
    if (!r.path.length) { r.status = 'cut'; continue; }
    const source = w.provinces[r.from]; r.item = isWorkshop(source.building) ? source.output : 'recruits';
    const blocked = source.hp <= 0 || w.provinces[r.to].hp <= 0 || w.battles.some(b => b.province === r.from), contested = r.path.some(id => w.battles.some(b => b.province === id));
    r.status = blocked ? 'idle' : contested ? 'delayed' : 'normal';
    // One-second flow intervals model transport delay, not inventory; unused arrivals expire.
    if (!blocked && w.tick % 30 === 1) {
      const start = w.tick + (r.path.length - 1) * 90 * (contested ? 2 : 1);
      const inputs = r.item === 'recruits' ? arrivingEquipment(w, r.from) : { [source.output]: source.level / 4 };
      const count = outgoingRoutes(w, r.from).length;
      for (const [item, rate] of Object.entries(inputs)) w.flows.push({ owner: r.owner, from: r.from, to: r.to, item: item as Item, rate: rate / count, start, end: start + 30 });
    }
  }
  if (w.tick % 30 === 1) transferRecruits(w);
  for (const s of [...w.shipments]) {
    const guns = s.troops.filter(t => t.bombard);
    if (guns.length) {
      const order = guns[0].bombard!, aim = artilleryAim(w, order, s.owner);
      if (!aim || distance(troopCenter(guns), aim.point) <= ARTILLERY_MAX) {
        const p = w.provinces.find(p => inside(s, p.polygon))!, ids = new Set(guns.map(t => t.id));
        order.center = troopCenter(guns); if (!aim) guns.forEach(t => { t.bombard = undefined; });
        if (w.battles.some(b => b.province === p.id) || p.owner >= 0 && p.owner !== s.owner) addBattle(w, p.id, guns.map(cleanSoldier));
        else station(p, guns.map(cleanSoldier));
        s.troops = s.troops.filter(t => !ids.has(t.id)); if (!s.troops.length) continue;
      } else if (s.to !== aim.province) {
        const path = marchPath(w, s, aim.province); if (path.length) { s.to = aim.province; s.path = path; s.leg = path.length === 1 ? -1 : 0; }
      }
    }
    if (s.transferRoute !== undefined && s.leg >= s.path.length - 1) { receiveRecruits(w, s); continue; }
    let next = s.path[s.leg + 1];
    if (!canPass(w, next, s.owner, s.to)) {
      const path = marchPath(w, s, s.to);
      if (path.length) { s.path = path; s.leg = path.length === 1 ? -1 : 0; next = path[s.leg + 1]; }
      else {
        // Return to the last reached province instead of teleporting past a newly blocked route.
        const home = s.path[Math.max(0, s.leg)]; s.path = [home]; s.leg = -1; s.to = home; next = home;
      }
    }
    const goal = w.provinces[next], gap = distance(s, goal), step = MOVE_SPEED * STEP;
    const angle = atan2(goal.y - s.y, goal.x - s.x);
    if (gap > step) { s.x += (goal.x - s.x) / gap * step; s.y += (goal.y - s.y) / gap * step; }
    else { s.x = goal.x; s.y = goal.y; s.leg++; }
    for (const t of s.troops) {
      const offset = marchOffset(t.marchSlot!, angle);
      moveSoldier(t, { x: s.x + offset.x, y: s.y + offset.y }, step);
    }
    const p = w.provinces[s.to], contested = p.owner !== s.owner || w.battles.some(b => b.province === p.id);
    if (s.transferRoute === undefined && contested && inside(s, p.polygon)) {
      addBattle(w, p.id, s.troops, { x: s.x, y: s.y }); s.troops = []; continue;
    }
    if (s.leg < s.path.length - 1) continue;
    if (s.transferRoute !== undefined) receiveRecruits(w, s);
    else { station(p, s.troops.map(cleanSoldier)); s.troops = []; }
  }
  w.shipments = w.shipments.filter(s => s.troops.length);
}
function production(w: World) {
  for (const p of w.provinces) {
    if (p.owner < 0 || !w.factions[p.owner].alive || !p.building || p.hp <= 0) continue;
    const battle = w.battles.find(b => b.province === p.id);
    if (p.building === 'mine') { if (!battle) w.factions[p.owner].gold += STEP * (3 + p.level); continue; }
    if (isWorkshop(p.building)) continue;
    if (!battle && p.mobile.length && p.troops.length < CAPACITY) p.troops.push(...p.mobile.splice(0, CAPACITY - p.troops.length));
    const count = reservedTroops(w, p.id);
    if (count >= CAPACITY) p.recruitment = 0;
    else {
      p.recruitment += STEP * (1 + (p.level - 1) * .3) / 3;
      if (p.recruitment + 1e-9 >= 1) { p.recruitment = Math.max(0, p.recruitment - 1); const position = fortPosition(p); position.y += 14; p.troops.push({ ...soldier(w, p.owner), weapon: null, ammo: null, recruit: true, position, angle: Math.PI / 2 }); }
    }
    assignSlots(p, [...p.troops, ...p.mobile]);
    const state = productionState(w, p.id);
    for (const item of Object.keys(p.assembly) as Item[]) if (!state.items.includes(item)) delete p.assembly[item];
    if (state.error || state.forwarding) { p.assembly = {}; continue; }
    const items = [...state.items].sort((a, b) => (state.inputs[b] ?? 0) - (state.inputs[a] ?? 0) || Number(b in LAUNCHERS) - Number(a in LAUNCHERS));
    for (const item of items) {
      const candidates = [...p.troops, ...p.mobile].filter(s => s.owner === p.owner && canEquip(s, item))
        .sort((a, b) => b.effects.length + Number(!!b.weapon) + Number(!!b.ammo) - a.effects.length - Number(!!a.weapon) - Number(!!a.ammo) || a.id - b.id);
      if (!candidates.length || !state.inputs[item]) { p.assembly[item] = 0; continue; }
      const progress = (p.assembly[item] ?? 0) + STEP * state.inputs[item]!, amount = Math.min(candidates.length, Math.floor(progress + 1e-9));
      for (const unit of candidates.slice(0, amount)) {
        if (item in LAUNCHERS) { const base = LAUNCHERS[item as Launcher]; unit.weapon = base.weapon; unit.ammo = base.ammo; }
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
  advanceArtillery(w); logistics(w); production(w);
  for (const p of w.provinces) {
    const troops = [...p.troops, ...p.mobile]; assignSlots(p, troops);
    const slots = formation(p, Math.max(0, ...troops.map(s => s.slot! + 1)));
    for (const s of troops) if (!s.bombard) moveSoldier(s, slots[s.slot!], MOVE_SPEED * STEP);
  }
  for (const b of [...w.battles]) stepBattle(w, b);
  stepArtillery(w); stepAttacks(w); resolveDeaths(w);
  for (const b of [...w.battles]) {
    const p = w.provinces[b.province];
    const occupier = b.fighters.find(f => f.hp > 0 && f.owner !== p.owner && distance(f, FORT) <= FORT.radius + 70);
    if (p.hp <= 0 && occupier) {
      const old = p.owner, owner = occupier.owner, hq = p.building === 'hq';
      p.owner = owner; p.hp = 1000; b.models = false;
      w.routes = w.routes.filter(r => r.from !== p.id && r.to !== p.id); p.assembly = {}; p.recruitment = 0;
      for (const s of [...p.troops, ...p.mobile]) if (s.recruit && !canFight(s)) s.owner = owner;
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
    const attacking = w.battles.find(b => b.province === p.id)?.fighters.some(f => f.target === -1 && f.targetOwner === p.owner && distance(f, FORT) <= WEAPONS[f.weapon!].range + FORT.radius);
    if (!attacking && w.time - p.lastHit > 8) p.hp = Math.min(1000, p.hp + STEP * 50);
  }
}
export function trainingBattle(w: World, loadout: Loadout, amount = 40) {
  const target = w.factions[1].hq;
  w.battles = []; w.shipments = []; w.casualties = []; w.projectiles = []; w.fields = []; w.visuals = []; w.winner = null; w.result = null; w.stats.forEach(s => { s.kills = 0; s.losses = 0; });
  const p = w.provinces[target]; p.owner = 1; p.building = null; p.hp = 1000; p.troops = []; p.mobile = [];
  const allies = Array.from({ length: amount }, () => ({ ...soldier(w, 0, loadout.weapon!, loadout.ammo!), effects: [...loadout.effects] }));
  const enemies = Array.from({ length: amount }, () => soldier(w, 1, 'launcher'));
  if (loadout.effects.includes('lob')) {
    for (const province of w.provinces) { province.troops = []; province.mobile = []; }
    const source = w.provinces.filter(q => q.owner === 0 && distance(q, p) >= 100 && distance(q, p) <= 280).sort((a, b) => distance(a, p) - distance(b, p))[0];
    source.troops = allies; assignSlots(source, allies); p.troops = enemies; assignSlots(p, enemies);
    const aim = enemies[0].position!;
    for (const s of allies) s.bombard = { id: w.nextId++, province: p.id, point: { ...aim }, targets: enemies.map(enemy => enemy.id) };
    return target;
  }
  const positions = formation(p, amount * 2).sort((a, b) => a.x - b.x || a.y - b.y);
  for (const [units, direction] of [[allies, -1], [enemies, 1]] as const) units.forEach((unit, i) => {
    unit.position = { ...positions[i + (direction === 1 ? amount : 0)] };
    unit.angle = direction === -1 ? 0 : Math.PI;
  });
  addBattle(w, target, [...allies, ...enemies]); return target;
}
