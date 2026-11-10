import type { Point } from '../sim/types.ts';

export function toggleUnits(current: Set<number>, clicked: number[], additive: boolean) {
  if (!additive) return new Set(clicked);
  const result = new Set(current), remove = clicked.every(id => result.has(id));
  for (const id of clicked) { if (remove) result.delete(id); else result.add(id); }
  return result;
}
export const orderGesture = (distance: number, milliseconds: number) => distance >= 6 || milliseconds >= 280;
export const commandUnits = (ids: number[], half: boolean) => half ? ids.slice(0, Math.ceil(ids.length / 2)) : ids;
export function boxUnits(hits: { point: Point; ids: number[]; owner: number }[], a: Point, b: Point, owner = 0) {
  return [...new Set(hits.filter(h => h.owner === owner && h.point.x >= Math.min(a.x, b.x) && h.point.x <= Math.max(a.x, b.x) && h.point.y >= Math.min(a.y, b.y) && h.point.y <= Math.max(a.y, b.y)).flatMap(h => h.ids))];
}
