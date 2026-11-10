import { sin, cos, atan2 } from './math.ts';
import { distance, inside } from './map.ts';
import type { Point, Province, Soldier } from './types.ts';
import { FORT } from './types.ts';
export const MOVE_SPEED = 12;
export const polygonArea = (points: Point[]) => Math.abs(points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
export function battleFrame(p: Province) {
  // Province shape must not resize soldiers or weapon reach during a continuous march.
  const scale = .12;
  return { x: p.x - FORT.x * scale, y: p.y - FORT.y * scale, scale };
}
export const SOLDIER_SIZE = 2.7;
export const BATTLE_SPACING = SOLDIER_SIZE * 1.2;
export const troopCenter = (troops: Soldier[]): Point => ({ x: troops.reduce((sum, s) => sum + s.position!.x, 0) / troops.length, y: troops.reduce((sum, s) => sum + s.position!.y, 0) / troops.length });
export const buildingWidth = (p: Province) => p.building === 'hq' ? 36 : p.building ? 32 : 22;
export const fortPosition = (p: Province): Point => { const f = battleFrame(p); return { x: f.x + FORT.x * f.scale, y: f.y + FORT.y * f.scale }; };
export const toBattle = (p: Province, point: Point): Point => { const f = battleFrame(p); return { x: (point.x - f.x) / f.scale, y: (point.y - f.y) / f.scale }; };
export const toWorld = (p: Province, point: Point): Point => { const f = battleFrame(p); return { x: f.x + point.x * f.scale, y: f.y + point.y * f.scale }; };
const queues = new WeakMap<Province, Point[]>();
export function formation(p: Province, count: number): Point[] {
  if (!count) return [];
  let points = queues.get(p);
  if (!points) {
    const fort = fortPosition(p), minY = Math.min(...p.polygon.map(v => v.y)), maxY = Math.max(...p.polygon.map(v => v.y));
    let spacing = SOLDIER_SIZE * 1.9;
    points = [];
    while (points.length < 60) {
      points = [];
      const startY = fort.y + FORT.radius * battleFrame(p).scale + spacing;
      const rows: number[] = [];
      for (let y = startY; y < maxY; y += spacing) rows.push(y);
      for (let y = startY - spacing; y > minY; y -= spacing) rows.push(y);
      for (const y of rows) for (let col = 0; col < 10; col++) {
        const point = { x: p.x + (col - 4.5) * spacing, y };
        if (inside(point, p.polygon) && distance(point, fort) > FORT.radius * battleFrame(p).scale + SOLDIER_SIZE) points.push(point);
      }
      if (points.length < 60) spacing *= .9;
    }
    queues.set(p, points);
  }
  // Extra survivors use additional slots; existing slots never shift when the population changes.
  // Extend a copy of the base queue so a restored world does not depend on earlier population sizes.
  points = [...points];
  if (count > points.length) {
    const originals = [...points];
    for (let layer = 1; points.length < count; layer++) for (const point of originals) {
      const extra = { x: point.x + SOLDIER_SIZE / (layer + 1), y: point.y + SOLDIER_SIZE / (layer + 1) };
      if (inside(extra, p.polygon)) points.push(extra);
    }
  }
  return points.slice(0, count);
}
export function assignSlots(p: Province, troops: Soldier[]) {
  const used = new Set(troops.flatMap(s => s.slot === undefined ? [] : [s.slot]));
  let free = 0;
  for (const s of troops) {
    if (s.slot === undefined) { while (used.has(free)) free++; s.slot = free; used.add(free); }
    s.angle ??= -Math.PI / 2;
  }
  const slots = formation(p, Math.max(0, ...troops.map(s => s.slot! + 1)));
  for (const s of troops) s.position ??= { ...slots[s.slot!] };
}
export function moveSoldier(s: Soldier, destination: Point, distanceLimit: number) {
  const position = s.position!, d = distance(position, destination);
  if (d < .001) return;
  s.angle = atan2(destination.y - position.y, destination.x - position.x);
  const scale = Math.min(1, distanceLimit / d);
  position.x += (destination.x - position.x) * scale; position.y += (destination.y - position.y) * scale;
}
export function marchOffset(slot: number, angle: number): Point {
  const side = (slot % 5 - 2) * SOLDIER_SIZE * 1.9, back = Math.floor(slot / 5) * SOLDIER_SIZE * 1.9;
  return { x: -sin(angle) * side - cos(angle) * back, y: cos(angle) * side - sin(angle) * back };
}
