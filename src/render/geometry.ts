import { distance, shortestPath } from '../sim/map.ts';
import type { Point, Route, World, Waypoint } from '../sim/types.ts';
export function lineDistance(p: Point, a: Point, b: Point) { const dx = b.x - a.x, dy = b.y - a.y, size = dx * dx + dy * dy; const t = size ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / size)) : 0; return distance(p, { x: a.x + t * dx, y: a.y + t * dy }); }
export function routeGeometry(w: World, route: Route, via: Waypoint[] = route.via): { point: Point; insert: number }[] {
  const anchors = [{ ...w.provinces[route.from], province: route.from }, ...via, { ...w.provinces[route.to], province: route.to }];
  const points = [{ point: anchors[0] as Point, insert: 0 }];
  for (let i = 0; i < anchors.length - 1; i++) {
    const path = shortestPath(w.provinces, anchors[i].province, anchors[i + 1].province, route.owner);
    if (!path.length) return [];
    for (let j = 1; j < path.length; j++) {
      const a = w.provinces[path[j - 1]], b = w.provinces[path[j]];
      const edge = a.polygon.filter(p => b.polygon.some(q => distance(p, q) < .01));
      points.push({ point: { x: (edge[0].x + edge[1].x) / 2, y: (edge[0].y + edge[1].y) / 2 }, insert: i });
      if (j < path.length - 1) points.push({ point: b, insert: i });
    }
    points.push({ point: anchors[i + 1], insert: i });
  }
  return points;
}
export function editedWaypoints(via: Waypoint[], point: Waypoint, index: number, moving: boolean) { const result = via.map(v => ({ ...v })); if (moving) result[index] = point; else result.splice(index, 0, point); return result; }
