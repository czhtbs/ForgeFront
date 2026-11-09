import { ARTILLERY_MAX, ARTILLERY_MIN, PAYLOADS, WEAPONS, canFight } from '../content/equipment.ts';
import type { Effect } from '../content/equipment.ts';
import type { Point, Projectile, Soldier, World, VisualEffect, Field } from './types.ts';
import { STEP } from './types.ts';
import { distance } from './map.ts';
import { fortPosition, toWorld } from './spatial.ts';

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
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const validTarget = (p: { owner: number; province: number | null }, t: AttackTarget) => t.unit.hp > 0 && t.unit.owner !== p.owner && (p.province === null || t.province === p.province && t.active);
export function visual(w: World, kind: VisualEffect['kind'], point: Point, target?: Point, life = .25) {
  w.visuals.push({ ...point, kind, target: target && { ...target }, life, max: life, angle: 0 });
}
export function hurt(w: World, target: AttackTarget, owner: number, amount: number, origin: Point, force = 1) {
  const s = target.unit;
  s.hp -= amount; s.killedBy = owner; s.hitAngle = Math.atan2(target.point.y - origin.y, target.point.x - origin.x); s.hitForce = force;
  visual(w, 'hit', target.point);
}
export function hurtBuilding(w: World, province: number, owner: number, amount: number, point = fortPosition(w.provinces[province])) {
  const p = w.provinces[province]; if (p.owner === owner) return;
  p.hp = Math.max(0, p.hp - amount); p.lastHit = w.time; p.capturedBy = owner;
  visual(w, 'fort-hit', point);
}
function chill(s: Soldier, amount = 1) {
  s.chill = Math.min(4, (s.chill ?? 0) + amount);
  if (s.chill >= 3 && !(s.frozen! > 0)) { s.frozen = .65; s.chill = 0; }
}
const fieldIndices = new WeakMap<World, Map<string, Field[]>>();
const fieldKey = (f: Pick<Field, 'owner' | 'province' | 'kind'>, x: number, y: number) => `${f.owner}:${f.province}:${f.kind}:${x},${y}`;
function field(w: World, p: Projectile, kind: Field['kind'], point: Point, damage: number, radius = 4.5) {
  const index = fieldIndices.get(w)!, owner = { owner: p.owner, province: p.province, kind }, life = kind === 'blast' ? .4 : 2.5;
  for (let x = Math.floor((point.x - radius / 2) / 5); x <= Math.floor((point.x + radius / 2) / 5); x++) for (let y = Math.floor((point.y - radius / 2) / 5); y <= Math.floor((point.y + radius / 2) / 5); y++) {
    const existing = index.get(fieldKey(owner, x, y))?.find(f => distance(f, point) < radius / 2);
    if (existing) { existing.life = Math.max(existing.life, life); existing.damage = Math.max(existing.damage, damage); return; }
  }
  const added = { ...point, ...owner, life, radius, damage, pulse: 0 }, key = fieldKey(added, Math.floor(point.x / 5), Math.floor(point.y / 5)), cell = index.get(key) ?? [];
  cell.push(added); index.set(key, cell); w.fields.push(added);
}
function electric(w: World, p: Projectile, targets: AttackTarget[]) {
  const count = p.effects.includes('split') ? 3 : 1, share = Math.max(1, p.effects.filter(e => PAYLOADS.includes(e)).length);
  const enemies = targets.filter(t => validTarget(p, t) && distance(p, t.point) <= 13).sort((a, b) => distance(p, a.point) - distance(p, b.point)).slice(0, count);
  for (const t of enemies) { hurt(w, t, p.owner, p.damage * .35 / count / share, p); visual(w, 'arc', p, t.point); }
}
function payload(w: World, p: Projectile, targets: AttackTarget[]) {
  const types = p.effects.filter(e => PAYLOADS.includes(e) && e !== 'arc');
  if (p.effects.includes('split') && types.length && !p.leaf) {
    for (let i = 0; i < 3; i++) {
      const angle = Math.atan2(p.vy, p.vx) + (i - 1) * 1.8;
      w.projectiles.push({ ...p, id: w.nextId++, effects: types, ammo: 'round', damage: p.damage / 3, vx: Math.cos(angle) * 35, vy: Math.sin(angle) * 35, aim: { x: p.x + Math.cos(angle) * 12, y: p.y + Math.sin(angle) * 12 }, origin: { x: p.x, y: p.y }, remaining: 12, life: .4, phase: 'flight', hits: [], leaf: true, pulse: 0, returning: false, airborne: false, lingered: true });
    }
    return;
  }
  const share = Math.max(1, p.effects.filter(e => PAYLOADS.includes(e)).length);
  if (types.includes('blast')) {
    const radius = p.effects.includes('lob') ? 12 : 6;
    for (const t of targets) if (validTarget(p, t) && distance(p, t.point) <= radius) hurt(w, t, p.owner, p.damage * 1.4 / share, p, 1.7);
    for (const fort of w.provinces) if ((p.province === null || fort.id === p.province) && distance(p, fortPosition(fort)) < radius + 3) hurtBuilding(w, fort.id, p.owner, p.damage * 1.4 / share, p);
    visual(w, 'blast', p, undefined, .55);
  }
  if (types.includes('burn')) field(w, p, 'burn', p, p.damage * .2 / share);
  if (types.includes('frost')) field(w, p, 'frost', p, p.damage * .15 / share);
  if (p.effects.includes('arc') && p.effects.includes('lob')) electric(w, p, targets);
}
function finish(w: World, p: Projectile, targets: AttackTarget[]) {
  if (p.effects.includes('linger') && !p.lingered) { p.lingered = true; if (p.ammo === 'beam') p.life = 2; else { p.phase = 'linger'; p.timer = 2; } return; }
  if (p.effects.includes('return') && !p.returning) {
    p.returning = true; p.airborne = p.effects.includes('lob'); p.phase = 'flight'; p.hits = []; p.aim = { ...p.origin }; p.target = undefined;
    p.remaining = distance(p, p.origin); p.life = p.ammo === 'beam' ? .4 : p.remaining / Math.max(1, Math.hypot(p.vx, p.vy)) + .1;
    const angle = Math.atan2(p.origin.y - p.y, p.origin.x - p.x), speed = Math.max(20, Math.hypot(p.vx, p.vy)); p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
    return;
  }
  if (p.effects.includes('delay') && p.phase !== 'delay') { p.phase = 'delay'; p.timer = .9; return; }
  payload(w, p, targets); p.phase = 'flight'; p.life = -1;
}
export function fireAttack(w: World, s: Soldier, origin: Point, aim: Point, province: number | null, target?: number) {
  const stats = WEAPONS[s.weapon!], scale = .12, angle = Math.atan2(aim.y - origin.y, aim.x - origin.x), lob = s.effects.includes('lob');
  const split = s.effects.includes('split') && !s.effects.some(e => PAYLOADS.includes(e)), count = split ? 3 : 1;
  for (let i = 0; i < count; i++) {
    const a = angle + (i - (count - 1) / 2) * .22, speed = lob ? 75 : stats.speed * scale;
    const range = lob ? ARTILLERY_MAX : stats.range * scale;
    w.projectiles.push({ id: w.nextId++, owner: s.owner, source: s.id, province, weapon: s.weapon!, ammo: s.ammo!, effects: split ? s.effects.filter(e => e !== 'split') : [...s.effects], x: origin.x, y: origin.y, origin: { ...origin }, aim: { ...aim }, target, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, damage: stats.damage * (lob ? 2 : 1) / count, remaining: range, life: s.ammo === 'beam' ? .4 : range / speed, hits: [], bounces: 0, returning: false, airborne: lob, lingered: false, phase: 'flight', timer: 0, pulse: 0, trail: 0, leaf: false });
  }
}
function impact(w: World, p: Projectile, t: AttackTarget) {
  hurt(w, t, p.owner, p.damage, p);
  const share = Math.max(1, p.effects.filter(e => PAYLOADS.includes(e)).length);
  if (p.effects.includes('frost')) chill(t.unit, 1 / share);
  if (p.effects.includes('burn') && !p.effects.includes('split')) field(w, p, 'burn', t.point, p.damage * .15 / share);
}
function contacts(w: World, p: Projectile, from: Point, to: Point, targets: AttackTarget[], terminate = true) {
  const hits = targets.filter(t => validTarget(p, t) && !p.hits.includes(t.unit.id) && segmentDistance(t.point, from, to) < 1.1)
    .map(t => ({ key: t.unit.id, point: t.point, unit: t, fort: -1 }));
  for (const fort of w.provinces) {
    const point = p.target === -fort.id - 1 ? p.aim : fortPosition(fort);
    if ((p.province === null || fort.id === p.province) && fort.owner !== p.owner && fort.hp > 0 && !p.hits.includes(-fort.id - 1) && segmentDistance(point, from, to) < 2.5) hits.push({ key: -fort.id - 1, point, unit: undefined!, fort: fort.id });
  }
  hits.sort((a, b) => distance(from, a.point) - distance(from, b.point));
  for (const hit of hits) {
    if (hit.unit) impact(w, p, hit.unit); else hurtBuilding(w, hit.fort, p.owner, p.damage, hit.point);
    p.hits.push(hit.key);
    if (p.effects.includes('pierce') && p.hits.length < 3) { p.damage *= .7; continue; }
    p.x = hit.point.x; p.y = hit.point.y;
    if (p.effects.includes('bounce') && p.bounces < 2 && p.hits.length < 5) {
      const next = targets.filter(t => validTarget(p, t) && !p.hits.includes(t.unit.id) && distance(p, t.point) < 25).sort((a, b) => distance(p, a.point) - distance(p, b.point))[0];
      if (next) { p.bounces++; p.damage *= .7; p.target = next.unit.id; p.aim = { ...next.point }; const a = Math.atan2(next.point.y - p.y, next.point.x - p.x), speed = Math.hypot(p.vx, p.vy); p.vx = Math.cos(a) * speed; p.vy = Math.sin(a) * speed; return true; }
    }
    if (terminate) finish(w, p, targets); return true;
  }
  return false;
}
export function stepAttacks(w: World) {
  const allTargets = attackTargets(w), grid = new Map<string, AttackTarget[]>();
  const fieldIndex = new Map<string, Field[]>();
  for (const f of w.fields) { const key = fieldKey(f, Math.floor(f.x / 5), Math.floor(f.y / 5)), cell = fieldIndex.get(key) ?? []; cell.push(f); fieldIndex.set(key, cell); }
  fieldIndices.set(w, fieldIndex);
  for (const t of allTargets) { const key = `${Math.floor(t.point.x / 16)},${Math.floor(t.point.y / 16)}`, cell = grid.get(key) ?? []; cell.push(t); grid.set(key, cell); }
  const nearby = (point: Point, radius: number) => {
    const found: AttackTarget[] = [];
    for (let x = Math.floor((point.x - radius) / 16); x <= Math.floor((point.x + radius) / 16); x++) for (let y = Math.floor((point.y - radius) / 16); y <= Math.floor((point.y + radius) / 16); y++) found.push(...grid.get(`${x},${y}`) ?? []);
    return found;
  };
  for (const v of w.visuals) v.life -= STEP;
  w.visuals = w.visuals.filter(v => v.life > 0);
  for (const p of [...w.projectiles]) {
    const targets = p.ammo === 'beam' ? allTargets : nearby(p, 40);
    if (p.phase === 'delay') { p.timer -= STEP; if (p.timer <= 0) finish(w, p, targets); continue; }
    const lob = p.airborne; p.pulse -= STEP;
    if (p.phase === 'linger') {
      p.timer -= STEP;
      if (p.pulse <= 0) { for (const t of targets) if (validTarget(p, t) && distance(p, t.point) < 2.5) impact(w, { ...p, damage: p.damage * .2 }, t); if (p.effects.includes('arc')) electric(w, p, targets); p.pulse = .3; }
      if (p.timer <= 0) finish(w, p, targets); continue;
    }
    if (p.effects.includes('homing') && !p.returning) {
      const target = allTargets.find(t => t.unit.id === p.target && validTarget(p, t));
      if (target) p.aim = { ...target.point };
      const heading = Math.atan2(p.vy, p.vx), desired = Math.atan2(p.aim.y - p.y, p.aim.x - p.x), delta = Math.atan2(Math.sin(desired - heading), Math.cos(desired - heading));
      const angle = heading + Math.max(-STEP * 2.5, Math.min(STEP * 2.5, delta)), speed = Math.hypot(p.vx, p.vy); p.vx = Math.cos(angle) * speed; p.vy = Math.sin(angle) * speed;
    }
    if (p.effects.includes('arc') && !lob && p.pulse <= 0) { electric(w, p, targets); p.pulse = .4; }
    if (p.ammo === 'beam') {
      const source = targets.find(t => t.unit.id === p.source && t.unit.hp > 0);
      if (!source) { p.life = -1; continue; }
      if (!p.returning) { p.x = source.point.x; p.y = source.point.y; }
      const angle = Math.atan2(p.vy, p.vx), end = p.returning ? source.point : { x: p.x + Math.cos(angle) * p.remaining, y: p.y + Math.sin(angle) * p.remaining };
      if (p.timer <= 0) {
        const pulse = { ...p, hits: [], bounces: 0, damage: p.damage / 4, effects: p.effects.filter(e => ['pierce', 'bounce', 'frost', 'burn'].includes(e)) };
        let start = { x: p.x, y: p.y }, stop = end;
        for (let segment = 0; segment < 3; segment++) {
          const before = pulse.bounces, hit = contacts(w, pulse, start, stop, targets, false);
          p.aim = hit ? { x: pulse.x, y: pulse.y } : { ...stop }; visual(w, 'beam', start, p.aim, .12);
          if (pulse.bounces === before) break;
          start = { ...p.aim }; const heading = Math.atan2(pulse.vy, pulse.vx); stop = { x: start.x + Math.cos(heading) * 25, y: start.y + Math.sin(heading) * 25 };
        }
        if (p.effects.includes('trail')) for (let d = 7; d < distance(p, p.aim); d += 7) for (const kind of p.effects.filter(e => PAYLOADS.includes(e))) field(w, p, kind as Field['kind'], { x: p.x + Math.cos(angle) * d, y: p.y + Math.sin(angle) * d }, p.damage * .025, 3);
        p.timer = .1;
      }
      p.timer -= STEP; p.life -= STEP;
      if (p.life <= 0) { p.x = p.aim.x; p.y = p.aim.y; finish(w, p, targets); }
      continue;
    }
    const old = { x: p.x, y: p.y }, travel = Math.min(STEP, Math.max(0, p.life)), speed = Math.hypot(p.vx, p.vy);
    p.x += p.vx * travel; p.y += p.vy * travel; p.remaining -= speed * travel; p.life -= STEP; p.trail += speed * travel;
    if (p.effects.includes('trail') && !lob && p.trail >= 7) { p.trail = 0; for (const kind of p.effects.filter(e => PAYLOADS.includes(e))) field(w, p, kind as Field['kind'], p, p.damage * .1, 3); }
    if (lob) {
      if (segmentDistance(p.aim, old, p) < 2 || p.life <= 0 || p.remaining <= 0) {
        if (distance(p, p.aim) < speed * STEP + 2) { p.x = p.aim.x; p.y = p.aim.y; }
        p.airborne = false;
        const continues = p.effects.includes('pierce') || p.effects.includes('bounce');
        if (continues) { p.remaining = 25; p.life = 25 / Math.max(1, speed); }
        const hit = contacts(w, p, p, p, targets);
        if (!hit && !continues) finish(w, p, targets);
      }
    } else if (!contacts(w, p, old, p, targets) && (p.life <= 0 || p.remaining <= 0 || p.returning && distance(p, p.origin) < speed * STEP + 1)) finish(w, p, targets);
  }
  w.projectiles = w.projectiles.filter(p => p.life >= 0 || p.phase !== 'flight');
  for (const f of w.fields) {
    f.life -= STEP; f.pulse -= STEP; if (f.pulse > 0) continue; f.pulse = .4;
    for (const t of nearby(f, f.radius)) if (validTarget(f, t) && distance(f, t.point) <= f.radius) { hurt(w, t, f.owner, f.damage, f); if (f.kind === 'frost') chill(t.unit, .6); }
    if (f.kind === 'burn' || f.kind === 'blast') for (const fort of w.provinces) if ((f.province === null || fort.id === f.province) && distance(f, fortPosition(fort)) <= f.radius + 2) hurtBuilding(w, fort.id, f.owner, f.damage);
  }
  w.fields = w.fields.filter(f => f.life > 0);
}
export function artilleryError(w: World, s: Soldier, point: Point): string | null {
  if (!canFight(s) || !s.effects.includes('lob')) return '跨地块炮击需要抛射配件';
  if (distance(s.position!, point) < ARTILLERY_MIN) return '目标处于最小交火距离内';
  if (distance(s.position!, point) > ARTILLERY_MAX) return '目标超出炮击射程';
  if (attackTargets(w).some(t => t.unit.owner !== s.owner && t.unit.hp > 0 && canFight(t.unit) && distance(s.position!, t.point) < ARTILLERY_MIN)) return '近距离受敌压制，无法炮击';
  return null;
}
export function stepArtillery(w: World) {
  const shooters = [...w.provinces.flatMap(p => [...p.troops, ...p.mobile]), ...w.battles.flatMap(b => b.fighters)];
  const targets = attackTargets(w);
  for (const s of shooters) {
    s.artilleryCooldown = Math.max(0, (s.artilleryCooldown ?? 0) - STEP);
    const order = s.bombard; if (!order || s.hp <= 0 || s.frozen! > 0) continue;
    const target = targets.find(t => t.unit.id === order.target && t.unit.hp > 0 && t.unit.owner !== s.owner);
    if (w.provinces[order.province].owner === s.owner && !target && !targets.some(t => t.unit.hp > 0 && t.unit.owner !== s.owner && distance(t.point, order.point) < 20)) { s.bombard = undefined; continue; }
    const aim = s.effects.includes('homing') && target ? target.point : order.point;
    if (s.artilleryCooldown > 0 || artilleryError(w, s, aim)) continue;
    fireAttack(w, s, s.position!, aim, null, target?.unit.id); s.artilleryCooldown = Math.max(2.5, WEAPONS[s.weapon!].interval * 3);
  }
}
export function resolveDeaths(w: World) {
  const dead = new Set<number>();
  for (const t of attackTargets(w)) {
    const s = t.unit;
    s.frozen = Math.max(0, (s.frozen ?? 0) - STEP); s.chill = Math.max(0, (s.chill ?? 0) - STEP * .25);
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
