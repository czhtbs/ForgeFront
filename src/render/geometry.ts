import { distance, shortestPath } from '../sim/map.ts';
import type { Point, Route, World, Waypoint } from '../sim/types.ts';
import { fortPosition } from '../sim/spatial.ts';
export function lineDistance(p: Point, a: Point, b: Point) { const dx = b.x - a.x, dy = b.y - a.y, size = dx * dx + dy * dy; const t = size ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / size)) : 0; return distance(p, { x: a.x + t * dx, y: a.y + t * dy }); }
export function routeGeometry(w: World, route: Route, via: Waypoint[] = route.via): { point: Point; insert: number }[] {
  const anchors = [{ ...fortPosition(w.provinces[route.from]), province: route.from }, ...via, { ...fortPosition(w.provinces[route.to]), province: route.to }];
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

export const lineLength = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
export function pointAlong(points: Point[], travel: number): Point {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    if (length > 0 && travel <= length) { const t = Math.max(0, travel) / length; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
    travel -= length;
  }
  return points[points.length - 1];
}
export const ROUTE_COLORS = [0x179785, 0x398bc5, 0xb577c7, 0xd29528, 0xd87153, 0x688c29];
export const routeNumber = (w: World, id: number) => w.routes.filter(r => r.owner === 0).findIndex(r => r.id === id) + 1;
export const attackDestination = (w: World, province: number, owner: number) => w.provinces[province].owner !== owner || w.battles.some(b => b.province === province && [...b.fighters, ...b.reserve].some(s => s.owner !== owner));
export function supplyLanes(w: World, selected: number, zoom: number) {
  const routes = w.routes.map(r => ({ r, highlighted: r.owner === 0 && (r.from === selected || r.to === selected), points: routeGeometry(w, r) }));
  const key = (a: Point, b: Point) => [`${a.x.toFixed(2)},${a.y.toFixed(2)}`, `${b.x.toFixed(2)},${b.y.toFixed(2)}`].sort().join(':');
  const shared = new Map<string, number[]>();
  for (const { r, points, highlighted } of routes) if (highlighted) for (let i = 1; i < points.length; i++) { const k = key(points[i - 1].point, points[i].point), ids = shared.get(k) ?? []; if (!ids.includes(r.id)) ids.push(r.id); shared.set(k, ids); }
  return routes.map(route => {
    const { r, points, highlighted } = route; if (!highlighted || points.length < 2) return route;
    const shifts = points.slice(1).map((v, i) => {
      const a = points[i].point, b = v.point, ids = shared.get(key(a, b))!.sort((a, b) => a - b), lane = (ids.indexOf(r.id) - (ids.length - 1) / 2) * 18 / zoom;
      const length = distance(a, b), direction = a.x < b.x || a.x === b.x && a.y < b.y ? 1 : -1;
      return length ? { x: -(b.y - a.y) / length * lane * direction, y: (b.x - a.x) / length * lane * direction } : { x: 0, y: 0 };
    });
    const separated = points.map((v, i) => i === 0 || i === points.length - 1 ? v : { ...v, point: { x: v.point.x + (shifts[i - 1].x + shifts[i].x) / 2, y: v.point.y + (shifts[i - 1].y + shifts[i].y) / 2 } });
    // The short fan-out remains attached to the building; shared corridors stay separately clickable.
    const start = points[0].point, end = points.at(-1)!.point;
    const first = pointAlong(points.slice(0, 2).map(v => v.point), Math.min(12 / zoom, distance(start, points[1].point) / 3));
    const last = pointAlong(points.slice(-2).reverse().map(v => v.point), Math.min(12 / zoom, distance(end, points.at(-2)!.point) / 3));
    separated.splice(1, 0, { point: { x: first.x + shifts[0].x, y: first.y + shifts[0].y }, insert: points[1].insert });
    separated.splice(separated.length - 1, 0, { point: { x: last.x + shifts.at(-1)!.x, y: last.y + shifts.at(-1)!.y }, insert: points.at(-1)!.insert });
    return { ...route, points: separated };
  });
}

export function commandRibbon(points: Point[], zoom: number) {
  let ground = points.filter((p, i) => !i || distance(p, points[i - 1]) > .01);
  if (ground.length < 2) return { ground, face: [] as Point[], ridge: [] as Point[] };
  for (let pass = 0; pass < 2; pass++) {
    const smooth = [ground[0]];
    for (let i = 1; i < ground.length; i++) { const a = ground[i - 1], b = ground[i]; smooth.push({ x: a.x * .75 + b.x * .25, y: a.y * .75 + b.y * .25 }, { x: a.x * .25 + b.x * .75, y: a.y * .25 + b.y * .75 }); }
    smooth.push(ground.at(-1)!); ground = smooth;
  }
  const length = lineLength(ground), head = Math.min(13 / zoom, length * .22), lift = Math.min(25 / zoom, length * .18), left: Point[] = [], right: Point[] = [];
  for (let i = 0; i <= 28; i++) {
    const d = (length - head) * i / 28, p = pointAlong(ground, d), q = pointAlong(ground, Math.min(length, d + .1)), a = Math.atan2(q.y - p.y, q.x - p.x), width = (2.5 + Math.sin(i / 28 * Math.PI) * .8) / zoom;
    const y = p.y - Math.sin(d / length * Math.PI) * lift;
    left.push({ x: p.x - Math.sin(a) * width, y: y + Math.cos(a) * width }); right.push({ x: p.x + Math.sin(a) * width, y: y - Math.cos(a) * width });
  }
  const tip = ground.at(-1)!, neck = pointAlong(ground, length - head), angle = Math.atan2(tip.y - neck.y, tip.x - neck.x), y = neck.y - Math.sin((length - head) / length * Math.PI) * lift;
  const wings = [{ x: neck.x - Math.sin(angle) * 7 / zoom, y: y + Math.cos(angle) * 7 / zoom }, tip, { x: neck.x + Math.sin(angle) * 7 / zoom, y: y - Math.cos(angle) * 7 / zoom }];
  return { ground, face: [...left, ...wings, ...right.reverse()], ridge: left };
}
