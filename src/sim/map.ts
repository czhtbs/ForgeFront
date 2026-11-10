import { hypot } from './math.ts';
import type { Point, Province } from './types.ts';
export function randomSource(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
export const distance = (a: Point, b: Point) => hypot(a.x - b.x, a.y - b.y);
export function inside(p: Point, poly: Point[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
export const CELL_AREA = 9353;
export const MAP_SIZES = [{ count: 40, name: '小' }, { count: 60, name: '中' }, { count: 80, name: '大' }];
export function coastalCells(cells: Province[]) {
  const edges = new Map<string, { province: number; count: number }>();
  for (const p of cells) p.polygon.forEach((a, i) => {
    const b = p.polygon[(i + 1) % p.polygon.length], key = [a, b].map(v => `${v.x.toFixed(4)},${v.y.toFixed(4)}`).sort().join('/'), edge = edges.get(key);
    if (edge) edge.count++; else edges.set(key, { province: p.id, count: 1 });
  });
  return new Set([...edges.values()].filter(e => e.count === 1).map(e => e.province));
}
export function mapBounds(cells: Province[]) {
  const points = cells.flatMap(p => p.polygon);
  const left = Math.min(...points.map(p => p.x)), top = Math.min(...points.map(p => p.y));
  const width = Math.max(...points.map(p => p.x)) - left, height = Math.max(...points.map(p => p.y)) - top;
  return { left, top, width, height, x: left + width / 2, y: top + height / 2 };
}
function clip(poly: Point[], a: Point, b: Point) {
  const nx = b.x - a.x, ny = b.y - a.y, d = (b.x * b.x + b.y * b.y - a.x * a.x - a.y * a.y) / 2;
  const result: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], u = p.x * nx + p.y * ny - d, v = q.x * nx + q.y * ny - d;
    if (u <= 0) result.push(p);
    if ((u <= 0) !== (v <= 0)) { const t = u / (u - v); result.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
  }
  return result;
}
export function createMap(count: number, seed: number): Province[] {
  const rand = randomSource(seed), phase = rand() * Math.PI * 2, shape = Math.floor(rand() * 3), aspect = 1.2 + rand() * .9, rotation = rand() < .5 ? 0 : Math.PI / 2;
  const radius = (a: number) => shape === 2 ? 1 / (Math.abs(Math.cos(a)) ** 10 + Math.abs(Math.sin(a)) ** 10) ** .1 : shape === 1 ? 1 : 1 + .07 * Math.sin(a * 3 + phase) + .025 * Math.sin(a * 5 - phase);
  const outline = (a: number, r: number) => { const x = Math.cos(a) * r * aspect, y = Math.sin(a) * r; return { x: x * Math.cos(rotation) - y * Math.sin(rotation), y: x * Math.sin(rotation) + y * Math.cos(rotation) }; };
  let coast = Array.from({ length: 64 }, (_, i) => {
    const a = i / 64 * Math.PI * 2;
    return outline(a, radius(a));
  });
  const area = Math.abs(coast.reduce((sum, a, i) => { const b = coast[(i + 1) % coast.length]; return sum + a.x * b.y - b.x * a.y; }, 0)) / 2;
  const scale = Math.sqrt(count * CELL_AREA / area);
  const left = Math.min(...coast.map(p => p.x)) * scale - 60, top = Math.min(...coast.map(p => p.y)) * scale - 60;
  coast = coast.map(p => ({ x: p.x * scale - left, y: p.y * scale - top }));
  let seeds: Point[] = [];
  for (let i = 0; i < count; i++) {
    let best = { x: -left, y: -top }, gap = -1;
    for (let j = 0; j < 60; j++) {
      const a = rand() * Math.PI * 2, candidate = outline(a, Math.sqrt(rand()) * .91 * radius(a));
      const p = { x: candidate.x * scale - left, y: candidate.y * scale - top };
      const nearest = seeds.length ? Math.min(...seeds.map(q => distance(p, q))) : rand();
      if (nearest > gap) { gap = nearest; best = p; }
    }
    seeds.push(best);
  }
  const polygons = () => seeds.map((p, i) => seeds.reduce((poly, q, j) => i === j ? poly : clip(poly, p, q), coast));
  // One relaxation removes sliver cells while preserving irregular random cuts.
  seeds = polygons().map(poly => {
    let area = 0, x = 0, y = 0;
    poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length], cross = a.x * b.y - b.x * a.y; area += cross; x += (a.x + b.x) * cross; y += (a.y + b.y) * cross; });
    return { x: x / (3 * area), y: y / (3 * area) };
  });
  const shapes = polygons(), names = ['白桦', '北岭', '石桥', '松原', '河湾', '青麓', '长滩', '新港', '高原', '赤岩', '银谷', '西岗'];
  const cells = seeds.map((p, id): Province => ({ ...p, id, name: `${names[id % names.length]} ${String(id + 1).padStart(2, '0')}`, polygon: shapes[id], neighbors: [], terrain: Math.floor(rand() * 4), owner: -1, hp: 1000, building: null, level: 1, troops: [], mobile: [], output: 'rifle', assembly: {}, recruitment: 0, lastHit: -10, capturedBy: -1 }));
  for (const a of cells) for (const b of cells) if (a.id < b.id && a.polygon.filter(p => b.polygon.some(q => distance(p, q) < .01)).length >= 2) { a.neighbors.push(b.id); b.neighbors.push(a.id); }
  const edges = new Map<string, Point[]>();
  const bend = (p: Point) => ({ x: p.x + 3.2 * Math.sin(p.y / 11 + phase) + Math.sin(p.y / 4.5 - phase), y: p.y + 3.2 * Math.sin(p.x / 13 - phase) + .8 * Math.sin(p.x / 5.4 + phase) });
  for (const p of cells) {
    // Shared edges use one sampled curve, including identical vertices at junctions.
    p.polygon = p.polygon.flatMap((point, i, polygon) => {
      const rounded = (v: Point) => ({ x: Math.round(v.x * 1e6) / 1e6, y: Math.round(v.y * 1e6) / 1e6 });
      const a = rounded(point), b = rounded(polygon[(i + 1) % polygon.length]), forward = a.x < b.x || a.x === b.x && a.y < b.y;
      const start = forward ? a : b, end = forward ? b : a, key = `${start.x},${start.y}/${end.x},${end.y}`;
      let curve = edges.get(key);
      if (!curve) {
        const steps = Math.max(1, Math.ceil(distance(start, end) / 5));
        curve = Array.from({ length: steps + 1 }, (_, j) => bend({ x: start.x + (end.x - start.x) * j / steps, y: start.y + (end.y - start.y) * j / steps }));
        edges.set(key, curve);
      }
      return (forward ? curve : [...curve].reverse()).slice(0, -1);
    });
    Object.assign(p, bend(p));
  }
  const curvedArea = cells.reduce((sum, p) => sum + Math.abs(p.polygon.reduce((area, a, i, polygon) => { const b = polygon[(i + 1) % polygon.length]; return area + a.x * b.y - b.x * a.y; }, 0)) / 2, 0);
  const correction = Math.sqrt(count * CELL_AREA / curvedArea);
  for (const p of cells) { p.x *= correction; p.y *= correction; p.polygon = p.polygon.map(v => ({ x: v.x * correction, y: v.y * correction })); }
  return cells;
}
export function shortestPath(cells: Province[], start: number, end: number, owner: number): number[] {
  if (cells[start].owner !== owner || cells[end].owner !== owner) return [];
  const queue = [start], prev = new Map<number, number>([[start, -1]]);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === end) { const result = []; for (let p = id; p !== -1; p = prev.get(p)!) result.unshift(p); return result; }
    for (const n of cells[id].neighbors) if (cells[n].owner === owner && !prev.has(n)) { prev.set(n, id); queue.push(n); }
  }
  return [];
}
export function routePath(cells: Province[], from: number, to: number, via: number[], owner: number): number[] {
  const points = [from, ...via, to], path: number[] = [];
  for (let i = 0; i < points.length - 1; i++) { const part = shortestPath(cells, points[i], points[i + 1], owner); if (!part.length) return []; path.push(...(i ? part.slice(1) : part)); }
  return path;
}

export function movementPath(w: import('./types.ts').World, start: number, end: number, owner: number): number[] {
  const queue = [start], prev = new Map<number, number>([[start, -1]]);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === end) { const path: number[] = []; for (let p = id; p !== -1; p = prev.get(p)!) path.unshift(p); return path; }
    for (const n of w.provinces[id].neighbors) {
      const p = w.provinces[n];
      const contested = w.battles.some(b => b.province === n && [...b.fighters, ...b.reserve].some(s => s.owner !== owner));
      if (!prev.has(n) && (n === end || (p.owner === owner || p.owner === -1) && !contested)) { prev.set(n, id); queue.push(n); }
    }
  }
  return [];
}
