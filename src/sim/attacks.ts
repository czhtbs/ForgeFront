import { sin, cos, atan2, hypot } from './math.ts';
import { ARTILLERY_MAX, ARTILLERY_MIN, PAYLOADS, canFight } from '../content/equipment.ts';
import type { Payload, Weapon } from '../content/equipment.ts';
import { EFFECT_VALUES } from '../content/research.ts';
import { armorValue, attackInterval, moveSpeed, researchLevel } from './research.ts';
import type { Point, Projectile, Soldier, World, VisualEffect, Field, ArtilleryOrder } from './types.ts';
import { STEP } from './types.ts';
import { distance, inside } from './map.ts';
import { fortPosition, toWorld, toBattle, troopCenter, moveSoldier, SOLDIER_SIZE } from './spatial.ts';

export interface AttackTarget { unit: Soldier; point: Point; province: number | null; active: boolean }
export function attackTargets(w: World): AttackTarget[] {
  return [
    ...w.provinces.flatMap(p => [...p.troops, ...p.mobile].map(unit => ({ unit, point: unit.position!, province: p.id, active: canFight(unit) }))),
    ...w.battles.flatMap(b => [...b.fighters.map(unit => ({ unit, point: toWorld(w.provinces[b.province], unit), province: b.province, active: true })), ...b.reserve.map(unit => ({ unit, point: unit.position!, province: b.province, active: false }))]),
    ...w.shipments.flatMap(s => s.troops.map(unit => ({ unit, point: unit.position!, province: null, active: false }))),
  ];
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const validTarget = (p: { owner: number; province: number | null }, t: AttackTarget) => t.unit.hp > 0 && t.unit.owner !== p.owner && (p.province === null || t.province === p.province && t.active);
export function visual(w: World, kind: VisualEffect['kind'], point: Point, target?: Point, life = .25, radius?: number) {
  w.visuals.push({ x: point.x, y: point.y, kind, target: target && { ...target }, life, max: life, angle: 0, radius });
}
export function hurt(w: World, target: AttackTarget, owner: number, amount: number, origin: Point, force = 1, weapon: Weapon | 'true' = 'launcher') {
  const s = target.unit, damage = Math.max(0, amount - (weapon === 'true' ? 0 : armorValue(s, weapon === 'hilt')));
  if (!damage) return;
  s.hp -= damage; s.killedBy = owner; s.hitAngle = atan2(target.point.y - origin.y, target.point.x - origin.x); s.hitForce = force;
  visual(w, 'hit', target.point);
}
export function hurtBuilding(w: World, province: number, owner: number, amount: number, point = fortPosition(w.provinces[province]), showHit = true) {
  const p = w.provinces[province]; if (p.owner === owner) return;
  p.hp = Math.max(0, p.hp - amount); p.lastHit = w.time;
  if (showHit) visual(w, 'fort-hit', point);
}
interface EffectSource { owner: number; province: number | null; weapon: Weapon }
export function triggerEffect(w: World, source: EffectSource, kind: Payload, point: Point, targets = attackTargets(w)) {
  const level = researchLevel(w, source.owner, kind), stats = EFFECT_VALUES[kind], radius = stats.radius[level];
  if (kind === 'burn' || kind === 'frost') {
    w.fields.push({ x: point.x, y: point.y, owner: source.owner, province: source.province, weapon: source.weapon, kind, life: 4, radius, damage: kind === 'burn' ? EFFECT_VALUES.burn.damage[level] : 0 });
  } else if (kind === 'blast') {
    for (const t of targets) if (validTarget(source, t) && distance(point, t.point) <= radius) hurt(w, t, source.owner, EFFECT_VALUES.blast.damage[level], point, 1.7, source.weapon);
    for (const fort of w.provinces) if ((source.province === null || fort.id === source.province) && distance(point, fortPosition(fort)) < radius + 3) hurtBuilding(w, fort.id, source.owner, EFFECT_VALUES.blast.damage[level], point);
    visual(w, 'blast', point, undefined, .55, radius);
  } else {
    const enemies = targets.filter(t => validTarget(source, t) && distance(point, t.point) <= radius).sort((a, b) => distance(point, a.point) - distance(point, b.point) || a.unit.id - b.unit.id).slice(0, EFFECT_VALUES.arc.targets[level]);
    for (const t of enemies) { hurt(w, t, source.owner, EFFECT_VALUES.arc.damage[level], point, 1, 'true'); t.unit.shocked = .3; visual(w, 'arc', point, t.point); }
  }
}
function effect(w: World, p: Projectile, point: Point, targets: AttackTarget[]) {
  const kind = p.effects.find(e => PAYLOADS.includes(e)) as Payload | undefined; if (!kind) return;
  if (p.effects.includes('delay')) w.pendingEffects.push({ x: point.x, y: point.y, owner: p.owner, province: p.province, weapon: p.weapon, kind, remaining: .8 });
  else triggerEffect(w, p, kind, point, targets);
}
function projectile(w: World, s: Soldier, origin: Point, aim: Point, province: number | null, range: number, target?: number): Projectile {
  const angle = atan2(aim.y - origin.y, aim.x - origin.x), lob = s.effects.includes('lob'), speed = lob ? 75 : 90;
  return { id: w.nextId++, owner: s.owner, source: s.id, province: lob ? null : province, weapon: s.weapon!, ammo: s.ammo!, effects: [...s.effects], x: origin.x, y: origin.y, origin: { x: origin.x, y: origin.y }, aim: { x: aim.x, y: aim.y }, target, vx: cos(angle) * speed, vy: sin(angle) * speed, damage: 50, remaining: range, life: range / speed, hits: [], bounces: 0, returning: false, airborne: lob, lingered: false, phase: 'flight', timer: 0, trail: 0, leaf: false, triggered: false, initialRange: range, travelled: 0, directHits: 0, blocked: [] };
}
function mainTrigger(w: World, p: Projectile, targets: AttackTarget[]) {
  if (p.triggered) return;
  p.triggered = true; effect(w, p, p, targets);
  if (p.effects.includes('split') && !p.leaf) for (let i = -1; i <= 1; i++) {
    const angle = atan2(p.vy, p.vx) + i * Math.PI / 4, aim = { x: p.x + cos(angle) * 12, y: p.y + sin(angle) * 12 };
    const child = projectile(w, { ...p, hp: 1, id: p.source, effects: p.effects.filter(e => e !== 'split') }, p, aim, p.province, 12);
    child.leaf = true; child.blocked = targets.filter(t => validTarget(p, t) && distance(p, t.point) < 1.1).map(t => t.unit.id);
    for (const fort of w.provinces) if (distance(p, fortPosition(fort)) < 2.5) child.blocked.push(-fort.id - 1);
    w.projectiles.push(child);
  }
}
const budget = (p: Projectile) => 1 + (p.effects.includes('pierce') ? 2 : 0) + (p.effects.includes('bounce') ? 2 : 0);
function finish(w: World, p: Projectile, targets: AttackTarget[]) {
  mainTrigger(w, p, targets);
  if (p.effects.includes('linger') && !p.lingered) { p.lingered = true; p.phase = 'linger'; p.timer = 2; return; }
  if (p.effects.includes('return') && !p.returning) {
    p.returning = true; p.airborne = p.effects.includes('lob'); p.phase = 'flight'; p.hits = []; p.aim = { ...p.origin }; p.target = undefined;
    p.blocked = targets.filter(t => validTarget(p, t) && distance(p, t.point) < 1.1).map(t => t.unit.id);
    p.remaining = distance(p, p.origin); const speed = hypot(p.vx, p.vy), angle = atan2(p.origin.y - p.y, p.origin.x - p.x);
    p.life = p.remaining / speed; p.vx = cos(angle) * speed; p.vy = sin(angle) * speed;
    return;
  }
  p.phase = 'flight'; p.life = -1;
}
export function fireAttack(w: World, s: Soldier, origin: Point, aim: Point, province: number | null, target?: number) {
  w.projectiles.push(projectile(w, s, origin, aim, province, s.effects.includes('lob') ? distance(origin, aim) : 36, target));
}
function travel(w: World, p: Projectile, to: Point, targets: AttackTarget[]) {
  const from = { x: p.x, y: p.y }, length = distance(from, to), end = p.travelled + length;
  while (p.effects.includes('trail') && p.trail < 4 && end + 1e-8 >= p.initialRange * (p.trail + 1) / 5) {
    const ratio = length ? Math.max(0, Math.min(1, (p.initialRange * (p.trail + 1) / 5 - p.travelled) / length)) : 0;
    effect(w, p, { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }, targets); p.trail++;
  }
  p.travelled = end; p.remaining = Math.max(0, p.remaining - length); p.x = to.x; p.y = to.y;
}
function contacts(w: World, p: Projectile, to: Point, targets: AttackTarget[]) {
  const from = { x: p.x, y: p.y };
  p.blocked = p.blocked.filter(id => { const t = targets.find(t => t.unit.id === id); return id < 0 ? distance(p, fortPosition(w.provinces[-id - 1])) < 2.5 : !!t && distance(p, t.point) < 1.1; });
  const hits = targets.filter(t => validTarget(p, t) && !p.hits.includes(t.unit.id) && !p.blocked.includes(t.unit.id) && segmentDistance(t.point, from, to) < 1.1)
    .map(t => ({ key: t.unit.id, point: t.point, unit: t, fort: -1 }));
  for (const fort of w.provinces) {
    const point = p.target === -fort.id - 1 ? p.aim : fortPosition(fort), key = -fort.id - 1;
    if ((p.province === null || fort.id === p.province) && fort.owner !== p.owner && fort.hp > 0 && !p.hits.includes(key) && !p.blocked.includes(key) && segmentDistance(point, from, to) < 2.5) hits.push({ key, point, unit: undefined!, fort: fort.id });
  }
  hits.sort((a, b) => distance(from, a.point) - distance(from, b.point) || a.key - b.key);
  for (const hit of hits) {
    if (hit.unit && hit.unit.unit.hp <= 0) continue;
    if (p.returning ? p.hits.length >= 1 : p.directHits >= budget(p)) break;
    const length = distance(from, to), ratio = length ? Math.max(0, Math.min(1, ((hit.point.x - from.x) * (to.x - from.x) + (hit.point.y - from.y) * (to.y - from.y)) / length ** 2)) : 0;
    travel(w, p, { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }, targets);
    if (hit.unit) hurt(w, hit.unit, p.owner, p.damage, p, 1, p.weapon); else hurtBuilding(w, hit.fort, p.owner, p.damage, hit.point);
    p.hits.push(hit.key); p.directHits++; mainTrigger(w, p, targets);
    if (p.returning) { finish(w, p, targets); return true; }
    if (p.effects.includes('pierce') && p.directHits < 3) continue;
    if (p.effects.includes('bounce') && p.bounces < 2 && p.directHits < budget(p)) {
      const next = targets.filter(t => validTarget(p, t) && !p.hits.includes(t.unit.id) && distance(p, t.point) <= 18).sort((a, b) => distance(p, a.point) - distance(p, b.point) || a.unit.id - b.unit.id)[0];
      if (next) { p.phase = 'flight'; p.bounces++; p.target = next.unit.id; p.aim = { ...next.point }; const a = atan2(next.point.y - p.y, next.point.x - p.x), speed = hypot(p.vx, p.vy); p.vx = cos(a) * speed; p.vy = sin(a) * speed; p.remaining = distance(p, next.point) + 1; p.life = p.remaining / speed; return true; }
    }
    if (p.phase !== 'linger') finish(w, p, targets);
    return true;
  }
  travel(w, p, to, targets); return false;
}
export function stepAttacks(w: World) {
  const allTargets = attackTargets(w), grid = new Map<string, AttackTarget[]>();
  for (const t of allTargets) { const key = `${Math.floor(t.point.x / 16)},${Math.floor(t.point.y / 16)}`, cell = grid.get(key) ?? []; cell.push(t); grid.set(key, cell); }
  const nearby = (point: Point, radius: number) => {
    const found: AttackTarget[] = [];
    for (let x = Math.floor((point.x - radius) / 16); x <= Math.floor((point.x + radius) / 16); x++) for (let y = Math.floor((point.y - radius) / 16); y <= Math.floor((point.y + radius) / 16); y++) found.push(...grid.get(`${x},${y}`) ?? []);
    return found;
  };
  for (const v of w.visuals) v.life -= STEP;
  w.visuals = w.visuals.filter(v => v.life > 0);
  for (const pending of w.pendingEffects) { pending.remaining -= STEP; if (pending.remaining <= 1e-8) triggerEffect(w, pending, pending.kind, pending, nearby(pending, 16)); }
  w.pendingEffects = w.pendingEffects.filter(p => p.remaining > 1e-8);
  for (const p of [...w.projectiles]) {
    const targets = nearby(p, 24);
    if (p.phase === 'linger') {
      p.timer -= STEP;
      if (p.directHits < budget(p)) contacts(w, p, p, targets);
      if (p.timer <= 0) finish(w, p, targets); continue;
    }
    if (p.effects.includes('homing') && !p.returning) {
      const target = allTargets.find(t => t.unit.id === p.target && validTarget(p, t));
      if (target) {
        p.aim = { ...target.point };
        const heading = atan2(p.vy, p.vx), desired = atan2(p.aim.y - p.y, p.aim.x - p.x), delta = atan2(sin(desired - heading), cos(desired - heading));
        const angle = heading + Math.max(-STEP * Math.PI * 2 / 3, Math.min(STEP * Math.PI * 2 / 3, delta)), speed = hypot(p.vx, p.vy); p.vx = cos(angle) * speed; p.vy = sin(angle) * speed;
      }
    }
    const speed = hypot(p.vx, p.vy), lifetimeEnds = p.life <= STEP + 1e-8, length = Math.min(speed * STEP, p.remaining, speed * Math.max(0, p.life)), to = { x: p.x + p.vx / speed * length, y: p.y + p.vy / speed * length };
    p.life = Math.max(0, p.life - STEP);
    if (p.airborne) {
      travel(w, p, to, targets);
      if (p.remaining <= 1e-8 || lifetimeEnds || distance(p, p.aim) < .5) {
        p.airborne = false;
        const hit = contacts(w, p, p, targets); mainTrigger(w, p, targets);
        if (!hit) { if (!p.returning && (p.effects.includes('pierce') || p.effects.includes('bounce'))) { p.remaining = 12; p.life = 12 / speed; } else finish(w, p, targets); }
      }
    } else if (!contacts(w, p, to, targets) && (p.remaining <= 1e-8 || lifetimeEnds)) finish(w, p, targets);
  }
  w.projectiles = w.projectiles.filter(p => p.life >= 0 || p.phase !== 'flight');
  const burns = new Map<number, { f: Field; damage: number }>(), frosts = new Map<number, Field>(), forts = new Map<number, Field>();
  for (const f of w.fields) {
    const level = researchLevel(w, f.owner, f.kind), stats = EFFECT_VALUES[f.kind]; f.radius = stats.radius[level];
    f.damage = f.kind === 'burn' ? EFFECT_VALUES.burn.damage[level] : 0;
    for (const t of nearby(f, f.radius)) if (validTarget(f, t) && distance(f, t.point) <= f.radius) {
      if (f.kind === 'burn') {
        const damage = Math.max(0, f.damage - armorValue(t.unit, f.weapon === 'hilt'));
        if (!burns.has(t.unit.id) || burns.get(t.unit.id)!.damage < damage) burns.set(t.unit.id, { f, damage });
      } else if (f.kind === 'frost') {
        const previous = frosts.get(t.unit.id);
        if (!previous || researchLevel(w, previous.owner, 'frost') < level) frosts.set(t.unit.id, f);
      }
    }
    if (f.kind === 'burn') for (const fort of w.provinces) if (fort.owner !== f.owner && (f.province === null || fort.id === f.province) && distance(f, fortPosition(fort)) <= f.radius + 2 && (!forts.has(fort.id) || forts.get(fort.id)!.damage < f.damage)) forts.set(fort.id, f);
    f.life -= STEP;
  }
  for (const t of allTargets) {
    const s = t.unit, burn = burns.get(s.id), frost = frosts.get(s.id); s.shocked = Math.max(0, (s.shocked ?? 0) - STEP);
    s.burning = burn ? Math.min(1, (s.burning ?? 0) + STEP / 1.5) : 0;
    if (burn && (s.burnNext ?? 0) <= w.time + 1e-8) { hurt(w, t, burn.f.owner, burn.damage, burn.f, 1, 'true'); s.burnNext = Math.max(s.burnNext ?? w.time, w.time - STEP) + .25; }
    s.frostImmune = Math.max(0, (s.frostImmune ?? 0) - STEP);
    if (!frost) { if (s.frozen! > 0) s.frostImmune = 1; s.chill = 0; s.frozen = 0; s.freezeElapsed = undefined; s.freezeOwner = undefined; }
    else if (s.freezeElapsed !== undefined) {
      s.freezeElapsed += STEP; s.frozen = Math.max(0, EFFECT_VALUES.frost.duration[researchLevel(w, s.freezeOwner!, 'frost')] - s.freezeElapsed);
      if (!s.frozen) { s.chill = 0; s.freezeElapsed = undefined; s.freezeOwner = undefined; s.frostImmune = 1; }
    } else if (!s.frostImmune) {
      s.chill = Math.min(100, (s.chill ?? 0) + EFFECT_VALUES.frost.cold[researchLevel(w, frost.owner, 'frost')] * STEP);
      if (s.chill >= 100 - 1e-8) { s.chill = 100; s.freezeElapsed = 0; s.freezeOwner = frost.owner; s.frozen = EFFECT_VALUES.frost.duration[researchLevel(w, frost.owner, 'frost')]; }
    }
  }
  for (const [id, f] of forts) { const p = w.provinces[id]; if ((p.burnNext ?? 0) <= w.time + 1e-8) { hurtBuilding(w, id, f.owner, f.damage); p.burnNext = Math.max(p.burnNext ?? w.time, w.time - STEP) + .25; } }
  w.fields = w.fields.filter(f => f.life > 1e-8);
}

export function artilleryAim(w: World, order: ArtilleryOrder, owner: number, targets = attackTargets(w)) {
  const ids = order.targets ?? (order.target === undefined ? [] : [order.target]);
  const target = targets.find(t => ids.includes(t.unit.id) && t.unit.hp > 0 && t.unit.owner !== owner);
  if (ids.length && !target) return;
  const point = target?.point ?? order.point;
  return { point, target: target?.unit.id, province: target?.province ?? w.provinces.find(p => inside(point, p.polygon))?.id ?? order.province };
}
export function artilleryError(w: World, s: Soldier, point: Point, center = s.position!): string | null {
  if (!canFight(s) || !s.effects.includes('lob')) return '跨地块炮击需要抛射配件';
  if (distance(center, point) < ARTILLERY_MIN) return '目标处于最小交火距离内';
  if (distance(center, point) > ARTILLERY_MAX) return '目标超出炮击射程';
  if (attackTargets(w).some(t => t.unit.owner !== s.owner && t.unit.hp > 0 && canFight(t.unit) && distance(center, t.point) < ARTILLERY_MIN)) return '近距离受敌压制，无法炮击';
  return null;
}
export function stepArtillery(w: World) {
  const targets = attackTargets(w), groups = new Map<ArtilleryOrder, AttackTarget[]>();
  for (const t of targets) if (t.active && t.unit.bombard) { const list = groups.get(t.unit.bombard) ?? []; list.push(t); groups.set(t.unit.bombard, list); }
  for (const [order, group] of groups) {
    const owner = group[0].unit.owner, aim = artilleryAim(w, order, owner, targets);
    if (!aim || !aim.target && w.provinces[order.province].owner === owner) { group.forEach(t => { t.unit.bombard = undefined; }); continue; }
    const troops = group.map(t => t.unit), rangeCenter = troopCenter(troops), center = order.center ?? rangeCenter;
    if (distance(rangeCenter, aim.point) > ARTILLERY_MAX) continue;
    order.center ??= center;
    const angle = atan2(aim.point.y - center.y, aim.point.x - center.x), columns = Math.ceil(Math.sqrt(troops.length)), rows = Math.ceil(troops.length / columns);
    const blocked = artilleryError(w, troops[0], aim.point, rangeCenter);
    const assigned = new Map<number, number>();
    for (const [i, t] of group.entries()) {
      const s = t.unit, side = (i % columns - (columns - 1) / 2) * SOLDIER_SIZE * 1.9, back = (Math.floor(i / columns) - (rows - 1) / 2) * SOLDIER_SIZE * 1.9;
      const slot = { x: center.x - sin(angle) * side - cos(angle) * back, y: center.y + cos(angle) * side - sin(angle) * back };
      s.artilleryCooldown = Math.max(0, (s.artilleryCooldown ?? 0) - STEP); s.recoil = Math.max(0, (s.recoil ?? 0) - STEP * 7);
      if (s.hp <= 0 || s.frozen! > 0) continue;
      s.position = { ...t.point }; moveSoldier(s, slot, moveSpeed(w, s) * STEP); s.angle = angle;
      if ('x' in s) Object.assign(s, toBattle(w.provinces[t.province!], s.position!));
      if (distance(s.position!, slot) > .5 || s.artilleryCooldown > 0 || blocked) continue;
      let shot = aim;
      if (s.chip === 'spread') {
        const candidate = targets.filter(t => t.province === aim.province && t.unit.hp > 0 && t.unit.owner !== owner && distance(s.position!, t.point) >= ARTILLERY_MIN && distance(s.position!, t.point) <= ARTILLERY_MAX).sort((a, b) => (assigned.get(a.unit.id) ?? 0) - (assigned.get(b.unit.id) ?? 0) || distance(s.position!, a.point) - distance(s.position!, b.point) || a.unit.id - b.unit.id)[0];
        if (candidate) shot = { point: candidate.point, target: candidate.unit.id, province: candidate.province! };
      }
      if (shot.target !== undefined) assigned.set(shot.target, (assigned.get(shot.target) ?? 0) + 1);
      fireAttack(w, s, s.position!, shot.point, null, shot.target); s.recoil = 1; s.artilleryCooldown = attackInterval(w, s);
    }
  }
}
export function resolveDeaths(w: World) {
  const dead = new Set<number>();
  for (const t of attackTargets(w)) {
    const s = t.unit;
    if (s.hp > 0 || dead.has(s.id)) continue; dead.add(s.id);
    w.stats[s.owner].losses++; if (s.killedBy !== undefined) w.stats[s.killedBy].kills++;
    w.casualties.push({ ...t.point, id: s.id, owner: s.owner, weapon: s.weapon, angle: s.hitAngle ?? s.angle ?? 0, force: s.hitForce ?? .7, time: w.time });
    const battle = w.battles.find(b => b.province === t.province); if (battle) battle.losses[s.owner]++;
  }
  for (const p of w.provinces) { p.troops = p.troops.filter(s => s.hp > 0); p.mobile = p.mobile.filter(s => s.hp > 0); }
  for (const b of w.battles) { b.fighters = b.fighters.filter(s => s.hp > 0); b.reserve = b.reserve.filter(s => s.hp > 0); }
  for (const s of w.shipments) s.troops = s.troops.filter(t => t.hp > 0);
  w.shipments = w.shipments.filter(s => s.troops.length);
}
