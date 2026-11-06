import type { Point, Province } from './types.ts';
export function randomSource(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function inside(p: Point, poly: Point[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function clip(poly: Point[], a: Point, b: Point) {
  const nx = b.x - a.x, ny = b.y - a.y, d = (b.x * b.x + b.y * b.y - a.x * a.x - a.y * a.y) / 2;
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const u = p.x * nx + p.y * ny - d, v = q.x * nx + q.y * ny - d;
    if (u <= 0) out.push(p);
    if ((u <= 0) !== (v <= 0)) { const t = u / (u - v); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
  }
  return out;
}
export function createMap(count: number, seed: number): Province[] {
  const rand = randomSource(seed);
  const coast: Point[] = Array.from({ length: 18 }, (_, i) => { const a = i / 18 * Math.PI * 2; return { x: 800 + Math.cos(a) * 740, y: 500 + Math.sin(a) * 440 }; });
  const seeds: Point[] = [];
  for (let i = 0; i < count; i++) {
    let best = { x: 800, y: 500 }, farthest = -1;
    for (let j = 0; j < 40; j++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * .96;
      const p = { x: 800 + Math.cos(a) * 730 * r, y: 500 + Math.sin(a) * 430 * r };
      const gap = seeds.length ? Math.min(...seeds.map(s => distance(s, p))) : rand();
      if (gap > farthest) { best = p; farthest = gap; }
    }
    seeds.push(best);
  }
  const names = ['白桦', '北岭', '石桥', '松原', '河湾', '青麓', '长滩', '新港', '高原', '赤岩', '银谷', '西岗'];
  const cells = seeds.map((p, id): Province => ({ ...p, id, name: `${names[id % names.length]} ${String(id + 1).padStart(2, '0')}`, polygon: seeds.reduce((poly, q, j) => j === id ? poly : clip(poly, p, q), coast), neighbors: [], terrain: Math.floor(rand() * 4), owner: -1, hp: 1000, building: null, level: 1, troops: [], mobile: [], output: 'mg', production: 0, recruitment: 0, productionKey: "", lastHit: -10, capturedBy: -1 }));
  for (const a of cells) for (const b of cells) {
    if (a.id >= b.id) continue;
    if (a.polygon.filter(p => b.polygon.some(q => distance(p, q) < .01)).length >= 2) { a.neighbors.push(b.id); b.neighbors.push(a.id); }
  }
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
