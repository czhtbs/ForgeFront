import { mapBounds, randomSource } from '../sim/map.ts';
import type { Province, Point } from '../sim/types.ts';

function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const hash = (a: number, b: number) => { let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed; n = Math.imul(n ^ n >>> 13, 1274126177); return ((n ^ n >>> 16) >>> 0) / 4294967295; };
  return (hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u) * (1 - v) + (hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u) * v;
}
export function elevation(x: number, y: number, seed: number) {
  return noise(x / 145, y / 145, seed) * .65 + noise(x / 53, y / 53, seed + 19) * .25 + noise(x / 19, y / 19, seed + 81) * .08 + noise(x / 6, y / 6, seed + 174) * .02;
}
export function terrainCanvasSize(cells: Province[]) { const b = mapBounds(cells); return { width: Math.ceil(b.left + b.width + 60), height: Math.ceil(b.top + b.height + 60) }; }
export function drawTerrain(c: CanvasRenderingContext2D, cells: Province[], seed: number) {
  const { width, height } = terrainCanvasSize(cells), data = c.createImageData(width, height), heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) heights[y * width + x] = elevation(x, y, seed);
  c.fillStyle = '#58c8e5'; c.fillRect(0, 0, width, height);
  const rand = randomSource(seed + 331);
  c.strokeStyle = '#d8f7ed33'; c.lineWidth = .65;
  for (let i = 0; i < width * height / 800; i++) { const x = rand() * width, y = rand() * height; c.globalAlpha = Math.min(1, Math.min(x, y, width - x, height - y) / 60); c.beginPath(); c.ellipse(x, y, 3 + rand() * 9, .6, -.25, 0, Math.PI); c.stroke(); }
  c.globalAlpha = 1;
  const edges: Point[][] = [];
  for (const p of cells) for (let i = 0; i < p.polygon.length; i++) {
    const a = p.polygon[i], b = p.polygon[(i + 1) % p.polygon.length];
    if (!p.neighbors.some(id => cells[id].polygon.some(v => Math.hypot(v.x - a.x, v.y - a.y) < .01) && cells[id].polygon.some(v => Math.hypot(v.x - b.x, v.y - b.y) < .01))) edges.push([a, b]);
  }
  const coast = () => { c.beginPath(); for (const [a, b] of edges) { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); } };
  c.lineJoin = 'round'; c.lineCap = 'round';
  for (const [lineWidth, color] of [[22, '#adf0e52c'], [12, '#c9f5e548'], [5, '#eff7ca'], [1.8, '#fff7d9']] as const) { c.lineWidth = lineWidth; c.strokeStyle = color; coast(); c.stroke(); }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, h = heights[i], moisture = noise(x / 95, y / 95, seed + 491);
    const slope = (heights[y * width + Math.max(0, x - 2)] - heights[y * width + Math.min(width - 1, x + 2)] + heights[Math.max(0, y - 2) * width + x] - heights[Math.min(height - 1, y + 2) * width + x]) * 1.6;
    const dry = Math.max(0, Math.min(1, (moisture - .45) * 3)), grain = noise(x * .7, y * .7, seed + 79) * 4 - 2;
    const ridge = Math.sin(h * 45) > .975 ? -2 : 0, light = 1 + Math.max(-.065, Math.min(.075, slope));
    const green = [190 + h * 25, 213 + h * 22, 125 + h * 18], sand = [240, 223, 160];
    for (let channel = 0; channel < 3; channel++) data.data[i * 4 + channel] = (green[channel] * (1 - dry) + sand[channel] * dry) * light + grain + ridge;
    data.data[i * 4 + 3] = 255;
  }
  // One continuous height field under the province overlay avoids seams at political borders.
  const ground = new OffscreenCanvas(width, height); ground.getContext('2d')!.putImageData(data, 0, 0);
  c.save(); c.beginPath();
  for (const p of cells) { p.polygon.forEach((v, i) => i ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y)); c.closePath(); }
  c.clip(); c.drawImage(ground, 0, 0); c.restore();
}
