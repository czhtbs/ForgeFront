import { inside, randomSource } from '../sim/map.ts';
import { fortPosition, SOLDIER_SIZE } from '../sim/spatial.ts';
import type { Point, Province, Soldier, Casualty } from '../sim/types.ts';
import { canFight } from '../content/equipment.ts';

export const UNIT_WEAPONS = ['none', 'rifle', 'rocket'];
export const ARMY_PORTRAITS = [...UNIT_WEAPONS, 'sword'];
export { buildingWidth } from '../sim/spatial.ts';
export const spriteWeapon = (s: Pick<Soldier, 'weapon'> & Partial<Pick<Soldier, 'effects' | 'ammo'>>) => !s.weapon || s.weapon === 'hilt' ? 'none' : s.effects?.includes('lob') ? 'rocket' : 'rifle';
export const unitFrame = (s: Soldier, recoil = 0) => (s.owner * UNIT_WEAPONS.length + UNIT_WEAPONS.indexOf(canFight(s) ? spriteWeapon(s) : 'none')) * 4 + Math.round(recoil * 3);
export const portraitFrame = (s: Soldier) => ARMY_PORTRAITS.indexOf(s.weapon === 'hilt' && canFight(s) ? 'sword' : canFight(s) ? spriteWeapon(s) : 'none');
export function swordPose(s: Soldier, recoil: number) {
  const facing = s.angle ?? 0, t = 1 - recoil;
  const swing = recoil <= 0 ? .2 : t < .2 ? .2 - t * 6 : t < .7 ? -1 + (t - .2) * 4.4 : 1.2 - (t - .7) / .3;
  const angle = facing + swing, grip = { x: s.position!.x + Math.cos(facing) * .45 - Math.sin(facing) * .9, y: s.position!.y + Math.sin(facing) * .45 + Math.cos(facing) * .9 };
  const point = (along: number, side = 0) => ({ x: grip.x + Math.cos(angle) * along - Math.sin(angle) * side, y: grip.y + Math.sin(angle) * along + Math.cos(angle) * side });
  return { grip, pommel: point(-.45), tip: point(3), guardA: point(.25, -.45), guardB: point(.25, .45) };
}
export const appear = (age: number, duration: number) => { const t = Math.max(0, Math.min(1, age / duration)); return t * t * (3 - 2 * t); };
export const unitDetail = (zoom: number) => appear(SOLDIER_SIZE * zoom - 6, 4);
export function deathFragments(c: Casualty, age: number) {
  const rand = randomSource(c.id * 417), t = Math.min(.8, age), fade = 1 - appear(age - 3.8, 1.2);
  const weapon = ['rifle', 'rocket'].indexOf(spriteWeapon(c));
  const frames = [0, 1, ...(weapon >= 0 ? [2 + weapon] : [])];
  return frames.map((frame, i) => {
    const angle = c.angle + (rand() - .5) * 3.6, reach = SOLDIER_SIZE * (i === 0 ? .37 : .56 + rand() * .74) * c.force;
    const drift = 1 - Math.exp(-t * 5), hop = Math.sin(t / .8 * Math.PI) * SOLDIER_SIZE * (i === 0 ? .15 : .41);
    return { frame, x: c.x + Math.cos(angle) * reach * drift, y: c.y + Math.sin(angle) * reach * drift - hop, groundY: c.y + Math.sin(angle) * reach * drift, angle: angle + t * (i === 0 ? 1.2 : i % 2 ? 5 : -4), size: SOLDIER_SIZE * (i === 0 ? 1.02 : i === 1 ? .59 : i === 2 ? 1.3 : .74), alpha: fade };
  });
}
export function revealedLine(points: Point[], progress: number): Point[] {
  if (!points.length) return [];
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let left = lengths.reduce((a, b) => a + b, 0) * Math.max(0, Math.min(1, progress));
  const result = [points[0]];
  for (let i = 0; i < lengths.length; i++) {
    const a = points[i], b = points[i + 1], length = lengths[i];
    if (left >= length) { result.push(b); left -= length; }
    else { result.push({ x: a.x + (b.x - a.x) * left / length, y: a.y + (b.y - a.y) * left / length }); break; }
  }
  return result;
}
export interface Decoration extends Point { kind: 'pine' | 'tree' | 'mountain'; size: number; province: number }
export function decorations(p: Province, seed: number): Decoration[] {
  const rand = randomSource(seed + p.id * 9173), result: Decoration[] = [], fort = fortPosition(p);
  const angle = rand() * Math.PI * 2;
  const cluster = { x: p.x - 6 + Math.cos(angle) * 28, y: p.y + Math.sin(angle) * 28 };
  const count = p.terrain === 2 ? 5 + Math.floor(rand() * 3) : p.terrain === 3 ? 2 : rand() < .45 ? 0 : 1;
  for (let attempt = 0; result.length < count && attempt < 160; attempt++) {
    const clustered = attempt < 100 && result.length < count - 2 && p.terrain >= 2;
    const x = (clustered ? cluster.x : p.x) + (rand() - .5) * (clustered ? 48 : 86);
    const y = (clustered ? cluster.y : p.y) + (rand() - .5) * (clustered ? 42 : 80);
    const kind = p.terrain === 3 ? 'mountain' : rand() > .55 ? 'pine' : 'tree', size = kind === 'mountain' ? 16 + rand() * 7 : 9 + rand() * 5;
    // The entire square sprite envelope stays inside its cell, including canopy and shadow.
    const corners = [-1, 1].flatMap(dx => [-1, 1].map(dy => ({ x: x + dx * size / 2, y: y + dy * size / 2 })));
    if (!corners.every(c => inside(c, p.polygon)) || Math.hypot(x - fort.x, y - fort.y) < 27 + size / 2 || result.some(d => Math.hypot(d.x - x, d.y - y) < (size + d.size) * .36)) continue;
    result.push({ x, y, kind, size, province: p.id });
  }
  return result;
}
