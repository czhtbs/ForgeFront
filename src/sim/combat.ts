import { sin, cos, atan2 } from './math.ts';
import { WEAPONS, PAYLOADS, canFight, isWorkshop } from '../content/equipment.ts';
import { BATTLE_CAP, STEP, FORT } from './types.ts';
import type { Battle, Fighter, Point, Soldier, World } from './types.ts';
import { MOVE_SPEED, battleFrame, BATTLE_SPACING, buildingWidth, assignSlots, formation, toBattle, toWorld, SOLDIER_SIZE } from './spatial.ts';
import { distance, inside } from './map.ts';
import { fireAttack, hurt, hurtBuilding, visual } from './attacks.ts';
import { BUILDING_HITS } from '../content/building-hits.ts';
export function random(w: World) { w.rng = (Math.imul(w.rng, 1664525) + 1013904223) >>> 0; return w.rng / 4294967296; }
export const DEPLOY_TICKS = 6;
export function queueReinforcements(w: World, b: Battle, incoming: Soldier[], entry?: Point) {
  const province = w.provinces[b.province], slots = formation(province, b.reserve.length + incoming.length);
  for (const [index, unit] of incoming.entries()) {
    unit.deployAt = Math.max(w.tick, b.nextDeploy[unit.owner] ?? w.tick);
    b.nextDeploy[unit.owner] = unit.deployAt + DEPLOY_TICKS;
    if (entry) {
      const angle = atan2(province.y - entry.y, province.x - entry.x), lane = (index % 4 - 1.5) * SOLDIER_SIZE * 1.7;
      unit.position = { x: entry.x + cos(angle) * SOLDIER_SIZE * 1.5 - sin(angle) * lane, y: entry.y + sin(angle) * SOLDIER_SIZE * 1.5 + cos(angle) * lane };
      while (!inside(unit.position, province.polygon)) { unit.position.x = (unit.position.x + province.x) / 2; unit.position.y = (unit.position.y + province.y) / 2; }
      unit.angle = angle;
      const forward = Math.min(SOLDIER_SIZE * 2, distance(unit.position, province)), heading = atan2(province.y - unit.position.y, province.x - unit.position.x);
      unit.advanceTo = { x: unit.position.x + cos(heading) * forward, y: unit.position.y + sin(heading) * forward };
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
    battle = { province, fighters: [], reserve: [], nextDeploy: [], models: true, shots: 0, losses: w.factions.map(() => 0) };
    queueReinforcements(w, battle, [...p.troops, ...p.mobile].filter(canFight));
    p.troops = p.troops.filter(s => !canFight(s)); p.mobile = p.mobile.filter(s => !canFight(s));
    w.battles.push(battle);
  }
  queueReinforcements(w, battle, incoming, entry);
  return battle;
}
export function fortAim(w: World, province: number): Point {
  const p = w.provinces[province], points = BUILDING_HITS[isWorkshop(p.building) ? 'workshop' : p.building ?? 'fort'], [x, y] = points[Math.floor(random(w) * points.length)], scale = buildingWidth(p) / battleFrame(p).scale;
  return { x: FORT.x + x * scale, y: FORT.y + y * scale };
}
export function stepBattle(w: World, b: Battle) {
  const dt = STEP, province = w.provinces[b.province], frame = battleFrame(province), spacing = BATTLE_SPACING / frame.scale;
  reinforce(w, b);
  const grid = new Map<string, Fighter[]>();
  for (const f of b.fighters) {
    const key = `${Math.floor(f.x / 100)},${Math.floor(f.y / 100)}`;
    const cell = grid.get(key); if (cell) cell.push(f); else grid.set(key, [f]);
  }
  for (const f of b.fighters) {
    if (f.hp <= 0 || f.frozen! > 0) continue;
    f.cooldown -= dt; f.recoil = Math.max(0, f.recoil - dt * (f.weapon === 'hilt' ? 4 : 7)); f.suppressed = Math.max(0, f.suppressed - dt);
    const stats = WEAPONS[f.weapon!];
    let target = b.fighters.find(t => t.id === f.target && t.owner !== f.owner && t.hp > 0);
    if (!target) {
      let nearest = Infinity;
      for (const enemy of b.fighters) if (enemy.owner !== f.owner && enemy.hp > 0) {
        const d = distance(f, enemy); if (d < nearest) { target = enemy; nearest = d; }
      }
    }
    const waitingEnemy = b.reserve.some(s => s.owner !== f.owner && s.hp > 0);
    const fort = !target && !waitingEnemy && province.owner !== f.owner;
    f.target = target?.id ?? (fort ? -1 : undefined); f.targetOwner = fort ? province.owner : undefined;
    if (f.effects.includes('lob') && !(fort && province.hp <= 0)) { f.position = toWorld(province, f); continue; }
    let advance = f.advanceTo ? toBattle(province, f.advanceTo) : undefined;
    if (advance && (distance(f, advance) <= MOVE_SPEED / frame.scale * dt || (target || fort) && distance(f, target ?? FORT) - (fort ? FORT.radius : 0) <= stats.range)) { f.advanceTo = undefined; advance = undefined; }
    if (!fort) f.fortAim = undefined;
    else f.fortAim ??= f.weapon === 'hilt' ? { x: FORT.x, y: FORT.y } : fortAim(w, b.province);
    const goal = advance ?? target ?? FORT;
    const nearest = Math.max(0, distance(f, fort && !advance ? FORT : goal) - (fort && !advance ? FORT.radius : 0));
    const aim = fort && !advance ? f.fortAim! : goal, desired = atan2(goal.y - f.y, goal.x - f.x), facing = atan2(aim.y - f.y, aim.x - f.x), delta = atan2(sin(facing - f.angle), cos(facing - f.angle));
    f.angle += Math.max(-dt * 7, Math.min(dt * 7, delta));
    if ((advance || target || fort) && nearest > (advance ? 0 : fort && province.hp <= 0 ? 50 : stats.range * .9)) {
      const speed = MOVE_SPEED / frame.scale * (f.suppressed > 0 ? .45 : f.chill! > 0 ? .6 : 1);
      f.x += cos(desired) * speed * dt; f.y += sin(desired) * speed * dt;
    }
    f.position = toWorld(province, f);
    if (!advance && (target || fort) && nearest <= stats.range && f.cooldown <= 0 && (f.weapon === 'hilt' || Math.abs(delta) < .4)) {
      f.cooldown = stats.interval; f.recoil = 1; b.shots++;
      if (f.weapon === 'hilt') {
        const amount = stats.damage * (1 + f.effects.filter(e => PAYLOADS.includes(e)).length * .2);
        const enchantment = (point: Point) => {
          for (const effect of f.effects) {
            if (effect === 'blast') visual(w, 'blast', point, undefined, .35, 2);
            if (effect === 'arc') visual(w, 'arc', f.position!, point);
            if (effect === 'burn') visual(w, 'flame', point, undefined, .4);
            if (effect === 'frost') visual(w, 'frost', point, undefined, .4);
          }
        };
        if (fort) { const point = { x: f.position.x + cos(facing) * 3, y: f.position.y + sin(facing) * 3 }; hurtBuilding(w, province.id, f.owner, amount, point, false); enchantment(point); }
        else {
          const enemies = b.fighters.filter(t => t.owner !== f.owner && t.hp > 0 && distance(f, t) <= stats.range).sort((a, b) => Number(b.id === f.target) - Number(a.id === f.target) || distance(f, a) - distance(f, b));
          enemies.slice(0, f.effects.includes('pierce') ? 3 : 1).forEach((enemy, i) => { const point = toWorld(province, enemy); hurt(w, { unit: enemy, point, province: province.id, active: true }, f.owner, amount * .7 ** i, f.position!); enchantment(point); });
        }
      } else if (!fort || province.hp > 0) fireAttack(w, f, f.position!, toWorld(province, aim), province.id, target?.id ?? -province.id - 1);
      f.fortAim = undefined;
    }
  }
  // Resolve each pair symmetrically after movement so forward motion cannot defeat separation.
  for (let pass = 0; pass < 2; pass++) for (const f of b.fighters) {
    const gx = Math.floor(f.x / 100), gy = Math.floor(f.y / 100);
    for (let x = gx - 1; x <= gx + 1; x++) for (let y = gy - 1; y <= gy + 1; y++) for (const other of grid.get(`${x},${y}`) ?? []) {
      if (f.id >= other.id) continue;
      const d = distance(f, other);
      if (d >= spacing) continue;
      let angle = d ? atan2(f.y - other.y, f.x - other.x) : (f.id * 2.399 + other.id) % (Math.PI * 2);
      // A firing line spreads sideways instead of pushing its front rank into the target.
      if (f.owner === other.owner && f.target !== undefined && f.target === other.target) {
        const side = f.angle + Math.PI / 2;
        angle = side + ((f.x - other.x) * cos(side) + (f.y - other.y) * sin(side) < 0 ? Math.PI : 0);
      }
      const push = Math.min((spacing - d) / 2, dt * 120);
      const dx = cos(angle) * push, dy = sin(angle) * push;
      f.x += dx; f.y += dy; other.x -= dx; other.y -= dy;
    }
  }
  for (const f of b.fighters) f.position = toWorld(province, f);
}
