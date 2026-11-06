import { WEAPONS, canFight } from '../content/equipment.ts';
import { BATTLE_CAP, BATTLE_H, BATTLE_W, STEP, FORT } from './types.ts';
import type { Battle, Fighter, Point, Projectile, Soldier, World } from './types.ts';
import { MOVE_SPEED, battleFrame, troopSize, assignSlots, formation, toBattle, toWorld, SOLDIER_SIZE } from './spatial.ts';
import { distance, inside } from './map.ts';
export function random(w: World) { w.rng = (Math.imul(w.rng, 1664525) + 1013904223) >>> 0; return w.rng / 4294967296; }
export const DEPLOY_TICKS = 6;
export function queueReinforcements(w: World, b: Battle, incoming: Soldier[], entry?: Point) {
  const province = w.provinces[b.province], slots = formation(province, b.reserve.length + incoming.length);
  for (const [index, unit] of incoming.entries()) {
    unit.deployAt = Math.max(w.tick, b.nextDeploy[unit.owner] ?? w.tick);
    b.nextDeploy[unit.owner] = unit.deployAt + DEPLOY_TICKS;
    if (entry) {
      const angle = Math.atan2(province.y - entry.y, province.x - entry.x), lane = (index % 4 - 1.5) * SOLDIER_SIZE * 1.5;
      unit.position = { x: entry.x + Math.cos(angle) * SOLDIER_SIZE * 1.5 - Math.sin(angle) * lane, y: entry.y + Math.sin(angle) * SOLDIER_SIZE * 1.5 + Math.cos(angle) * lane };
      while (!inside(unit.position, province.polygon)) { unit.position.x = (unit.position.x + province.x) / 2; unit.position.y = (unit.position.y + province.y) / 2; }
      unit.angle = angle;
      const forward = Math.min(SOLDIER_SIZE * 2, distance(unit.position, province)), heading = Math.atan2(province.y - unit.position.y, province.x - unit.position.x);
      unit.advanceTo = { x: unit.position.x + Math.cos(heading) * forward, y: unit.position.y + Math.sin(heading) * forward };
    } else unit.position ??= unit.entry ? toWorld(province, unit.entry) : { ...slots[b.reserve.length + index] };
  }
  b.reserve.push(...incoming);
}
export function reinforce(w: World, b: Battle) {
  const province = w.provinces[b.province], owners = [...new Set([...b.fighters, ...b.reserve].filter(s => s.hp > 0).map(s => s.owner))].sort();
  const quota = Math.floor(BATTLE_CAP / Math.max(1, owners.length));
  for (const owner of owners) {
    const active = b.fighters.filter(f => f.owner === owner);
    if (active.length > quota) {
      const demoted = new Set(active.slice(quota).map(f => f.id));
      for (const f of active.slice(quota)) { f.position = toWorld(province, f); f.recoil = 0; b.reserve.push(f); }
      b.fighters = b.fighters.filter(f => !demoted.has(f.id));
    }
    let room = quota - b.fighters.filter(f => f.owner === owner).length;
    for (let i = 0; i < b.reserve.length && room > 0;) {
      const unit = b.reserve[i]; if (unit.owner !== owner || unit.hp <= 0 || (unit.deployAt ?? 0) > w.tick) { i++; continue; }
      if (!unit.position) {
        const slot = formation(province, i + 1)[i];
        unit.position = unit.entry ? toWorld(province, unit.entry) : { x: slot.x + (owner === province.owner ? 45 : -45), y: slot.y };
      }
      const point = toBattle(province, unit.position), previous = unit as Partial<Fighter>;
      b.reserve.splice(i, 1);
      b.fighters.push({ ...unit, ...point, angle: unit.angle ?? (owner === province.owner ? Math.PI : 0), cooldown: previous.cooldown ?? random(w), recoil: previous.recoil ?? 0, suppressed: previous.suppressed ?? 0 });
      room--;
    }
  }
}
export function addBattle(w: World, province: number, incoming: Soldier[], entry?: Point) {
  let battle = w.battles.find(b => b.province === province);
  if (!battle) {
    const p = w.provinces[province]; assignSlots(p, [...p.troops, ...p.mobile]);
    battle = { province, fighters: [], reserve: [], projectiles: [], clouds: [], visuals: [], wave: 0, nextDeploy: [], models: true, shots: 0, losses: w.factions.map(() => 0) };
    queueReinforcements(w, battle, [...p.troops, ...p.mobile].filter(canFight));
    p.troops = p.troops.filter(s => !canFight(s)); p.mobile = p.mobile.filter(s => !canFight(s));
    w.battles.push(battle);
  }
  queueReinforcements(w, battle, incoming, entry);
  return battle;
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function impact(w: World, b: Battle, bullet: Projectile, target: Fighter) {
  target.hp -= bullet.damage; target.killedBy = bullet.owner; target.suppressed = bullet.weapon === 'mg' ? .35 : target.suppressed;
  b.visuals.push({ x: target.x, y: target.y, kind: 'hit', life: .12, max: .12, angle: 0 });
  if (bullet.weapon === 'rocket' || bullet.effects.includes('blast')) {
    for (const f of b.fighters) if (f.owner !== bullet.owner && f.id !== target.id && distance(f, target) < 46) { f.hp -= bullet.damage * .65; f.killedBy = bullet.owner; }
    if (distance(target, FORT) < 46 + FORT.radius) hurtFort(w, b, bullet.owner, bullet.damage * .65);
    b.visuals.push({ x: target.x, y: target.y, kind: 'blast', life: .5, max: .5, angle: 0 });
  }
  if (bullet.effects.includes('gas')) b.clouds.push({ x: target.x, y: target.y, owner: bullet.owner, life: 3, radius: 45 });
  if (bullet.effects.includes('split')) {
    const nearby = b.fighters.filter(f => f.owner !== bullet.owner && f.id !== target.id && distance(f, target) < 90).sort((a, c) => distance(a, target) - distance(c, target)).slice(0, 2);
    for (const f of nearby) { f.hp -= bullet.damage * .45; f.killedBy = bullet.owner; b.visuals.push({ x: f.x, y: f.y, kind: 'hit', life: .12, max: .12, angle: 0 }); }
  }
}
function hurtFort(w: World, b: Battle, owner: number, damage: number) {
  const p = w.provinces[b.province];
  if (p.owner === owner || p.hp <= 0) return;
  p.hp -= damage; p.lastHit = w.time; p.capturedBy = owner;
  b.visuals.push({ x: FORT.x, y: FORT.y, kind: 'hit', life: .18, max: .18, angle: 0 });
}
export function stepBattle(w: World, b: Battle) {
  const dt = STEP, province = w.provinces[b.province], frame = battleFrame(province), spacing = troopSize(province) / frame.scale, muzzle = SOLDIER_SIZE * .75 / frame.scale, hitRadius = SOLDIER_SIZE * .35 / frame.scale;
  reinforce(w, b);
  const grid = new Map<string, Fighter[]>();
  for (const f of b.fighters) {
    const key = `${Math.floor(f.x / 100)},${Math.floor(f.y / 100)}`;
    const cell = grid.get(key); if (cell) cell.push(f); else grid.set(key, [f]);
  }
  for (const f of b.fighters) {
    if (f.hp <= 0) continue;
    f.cooldown -= dt; f.recoil = Math.max(0, f.recoil - dt * 7); f.suppressed = Math.max(0, f.suppressed - dt);
    const stats = WEAPONS[f.weapon];
    let target = b.fighters.find(t => t.id === f.target && t.owner !== f.owner && t.hp > 0);
    const gx = Math.floor(f.x / 100), gy = Math.floor(f.y / 100);
    if (!target) {
      let nearest = Infinity;
      for (const enemy of b.fighters) if (enemy.owner !== f.owner && enemy.hp > 0) {
        const d = distance(f, enemy); if (d < nearest) { target = enemy; nearest = d; }
      }
    }
    const waitingEnemy = b.reserve.some(s => s.owner !== f.owner && s.hp > 0);
    const fort = !target && !waitingEnemy && province.owner !== f.owner && province.hp > 0;
    f.target = target?.id ?? (fort ? -1 : undefined); f.targetOwner = fort ? province.owner : undefined;
    let advance = f.advanceTo ? toBattle(province, f.advanceTo) : undefined;
    if (advance && distance(f, advance) <= MOVE_SPEED / frame.scale * dt) { f.advanceTo = undefined; advance = undefined; }
    const goal = advance ?? target ?? FORT;
    const nearest = Math.max(0, distance(f, goal) - (fort && !advance ? FORT.radius : 0));
    const desired = Math.atan2(goal.y - f.y, goal.x - f.x), delta = Math.atan2(Math.sin(desired - f.angle), Math.cos(desired - f.angle));
    f.angle += Math.max(-dt * 7, Math.min(dt * 7, delta));
    if (nearest > (advance ? 0 : target || fort ? stats.range * .85 : 85)) {
      const speed = MOVE_SPEED / frame.scale * (f.suppressed > 0 ? .45 : 1);
      f.x += Math.cos(desired) * speed * dt; f.y += Math.sin(desired) * speed * dt;
    }
    for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) for (const other of grid.get(`${x},${y}`) ?? []) {
      if (f.id === other.id) continue;
      const d = distance(f, other);
      if (d < spacing) { const push = Math.min((spacing - d) / 2, dt * 40); f.x += (d ? (f.x - other.x) / d : f.id < other.id ? -1 : 1) * push; f.y += (d ? (f.y - other.y) / d : 0) * push; }
    }
    f.position = toWorld(province, f);
    if (!advance && (target || fort) && nearest <= stats.range && f.cooldown <= 0 && Math.abs(delta) < .4) {
      f.cooldown = stats.interval; f.recoil = 1; b.shots++;
      if (f.weapon === 'flame') {
        if (fort) hurtFort(w, b, f.owner, stats.damage);
        for (const enemy of b.fighters) {
          const a = Math.atan2(enemy.y - f.y, enemy.x - f.x);
          if (enemy.owner !== f.owner && distance(f, enemy) <= stats.range && Math.abs(Math.atan2(Math.sin(a - f.angle), Math.cos(a - f.angle))) < .45) impact(w, b, { owner: f.owner, damage: stats.damage, weapon: f.weapon, effects: f.effects } as Projectile, enemy);
        }
        b.visuals.push({ x: f.x, y: f.y, angle: f.angle, kind: 'flame', life: .17, max: .17 });
      } else b.projectiles.push({ id: w.nextId++, x: f.x + Math.cos(f.angle) * muzzle, y: f.y + Math.sin(f.angle) * muzzle, owner: f.owner, vx: Math.cos(f.angle) * stats.speed, vy: Math.sin(f.angle) * stats.speed, damage: stats.damage, weapon: f.weapon, effects: [...f.effects], life: (stats.range - muzzle) / stats.speed, hits: [] });
    }
  }
  for (const p of b.projectiles) {
    const old = { x: p.x, y: p.y }, travel = Math.min(dt, p.life); p.x += p.vx * travel; p.y += p.vy * travel; p.life -= travel;
    let stopped = false;
    const province = w.provinces[b.province];
    const fortHit = province.owner !== p.owner && province.hp > 0 && !p.hits.includes(-1) && segmentDistance(FORT, old, p) < FORT.radius;
    const hits = b.fighters.filter(f => f.hp > 0 && f.owner !== p.owner && !p.hits.includes(f.id) && segmentDistance(f, old, p) < hitRadius).sort((a, c) => distance(old, a) - distance(old, c));
    for (const hit of hits) {
      if (fortHit && distance(old, FORT) - FORT.radius < distance(old, hit) - hitRadius) break;
      impact(w, b, p, hit); p.hits.push(hit.id); if (!p.effects.includes('pierce') || p.hits.length >= 3) { p.life = 0; stopped = true; break; } p.damage *= .7; }
    if (fortHit && !stopped) { hurtFort(w, b, p.owner, p.damage); p.hits.push(-1); p.life = 0; }
  }
  b.projectiles = b.projectiles.filter(p => p.life > 0);
  for (const gas of b.clouds) { gas.life -= dt; for (const f of b.fighters) if (f.owner !== gas.owner && distance(f, gas) < gas.radius) { f.hp -= dt * 5; f.killedBy = gas.owner; } }
  b.clouds = b.clouds.filter(g => g.life > 0);
  for (const f of b.fighters) if (f.hp <= 0) { b.losses[f.owner]++; w.stats[f.owner].losses++; if (f.killedBy !== undefined) w.stats[f.killedBy].kills++; b.visuals.push({ x: f.x, y: f.y, angle: f.angle, kind: 'death', life: 2, max: 2 }); }
  b.fighters = b.fighters.filter(f => f.hp > 0);
  for (const v of b.visuals) v.life -= dt;
  b.visuals = b.visuals.filter(v => v.life > 0);
}
