import type Phaser from 'phaser';
import type { Point, World } from '../sim/types.ts';

type Graphics = Pick<Phaser.GameObjects.Graphics, 'fillStyle' | 'lineStyle' | 'fillCircle' | 'strokeCircle' | 'fillTriangle' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fillPath' | 'lineBetween'>;
export type EffectStamp = (texture: string, x: number, y: number, width: number, height: number, tint: number, alpha: number, angle?: number) => void;
const noise = (seed: number) => { const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const fade = (life: number, duration: number) => Math.max(0, Math.min(1, life / duration));

export function lightning(g: Graphics, a: Point, b: Point, phase: number, alpha: number) {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx), points = [a];
  for (let i = 1; i < 7; i++) {
    const offset = (noise(a.x + a.y * 3 + i * 5 + phase) - .5) * Math.min(4, length * .3);
    points.push({ x: a.x + dx * i / 7 - Math.sin(angle) * offset, y: a.y + dy * i / 7 + Math.cos(angle) * offset });
  }
  points.push(b);
  for (const [width, color, opacity] of [[1.8, 0x7960f3, .2], [.65, 0xb9a3ff, .9], [.22, 0xf5f0ff, 1]]) {
    g.lineStyle(width, color, alpha * opacity);
    for (let i = 1; i < points.length; i++) g.lineBetween(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
  g.lineStyle(.22, 0xc9baff, alpha * .7);
  for (const i of [2, 5]) {
    const p = points[i], side = i === 2 ? 1 : -1, reach = Math.min(2.8, length * .22);
    g.lineBetween(p.x, p.y, p.x + Math.cos(angle + side) * reach, p.y + Math.sin(angle + side) * reach);
  }
}
function snow(g: Graphics, x: number, y: number, radius: number, time: number, alpha: number) {
  g.fillStyle(0xb5eaf7, alpha * .12); g.fillCircle(x, y, radius);
  for (let i = 0; i < 12; i++) {
    const seed = noise(x + y * 3 + i * 7), fall = (time * (.2 + seed * .08) + i / 12) % 1;
    const dx = (noise(i * 11 + x) - .5) * radius * 1.4 + Math.sin(time * 1.3 + i) * radius * .05;
    const px = x + dx, py = y + (fall * 2 - 1) * Math.sqrt((radius * .86) ** 2 - dx ** 2), size = radius * (.075 + seed * .025);
    g.lineStyle(.13, 0xf4fdff, alpha * Math.sin(fall * Math.PI));
    for (let arm = 0; arm < 6; arm++) {
      const angle = arm * Math.PI / 3 + time * .22 + seed, tx = px + Math.cos(angle) * size, ty = py + Math.sin(angle) * size;
      g.lineBetween(px, py, tx, ty);
      for (const side of [-1, 1]) g.lineBetween(tx - Math.cos(angle) * size * .36, ty - Math.sin(angle) * size * .36, tx - Math.cos(angle + side * .65) * size * .56, ty - Math.sin(angle + side * .65) * size * .56);
    }
  }
}
function fire(g: Graphics, stamp: EffectStamp, x: number, y: number, radius: number, time: number, alpha: number) {
  stamp('glow', x, y, radius * 2, radius * 2, 0xf38c25, alpha * .14);
  for (let i = 0; i < 8; i++) {
    const seed = noise(x * 3 + y + i * 7), phase = time * (2 + seed) + seed * 8, angle = i * 2.399 + noise(x + y) * 6.28;
    const reach = radius * .76 * Math.sqrt((i + .5) / 8), px = x + Math.cos(angle) * reach, base = y + Math.sin(angle) * reach;
    const tip = radius * (.3 + .08 * Math.sin(phase * 3)), width = radius * .1, lean = Math.sin(phase * 2) * width;
    stamp('flame', px, base - tip * .45, width * 3, tip * 1.3, 0xffa031, alpha * .7, Math.sin(phase) * .12);
    g.fillStyle(0xf87922, alpha * .75); g.beginPath(); g.moveTo(px - width, base);
    g.lineTo(px - width * 1.1, base - tip * .35); g.lineTo(px - width * .3, base - tip * .65); g.lineTo(px + lean, base - tip);
    g.lineTo(px + width * .3, base - tip * .45); g.lineTo(px + width, base - tip * .25); g.lineTo(px + width * .7, base); g.closePath(); g.fillPath();
    g.fillStyle(0xffdf7d, alpha * .85); g.fillTriangle(px - width * .45, base, px + lean * .5, base - tip * .65, px + width * .45, base);
    const rise = (time * .8 + seed) % 1;
    g.fillStyle(0xffc34b, alpha * (1 - rise) * .7); g.fillCircle(px + Math.sin(phase) * width, base - rise * tip * 1.4, .08 + seed * .07);
  }
  stamp('smoke', x, y - radius * .25, radius * 1.8, radius, 0x746458, alpha * .08, Math.sin(time * .5) * .15);
}
function explosion(g: Graphics, stamp: EffectStamp, x: number, y: number, progress: number, alpha: number, size: number) {
  const radius = .4 + Math.sqrt(progress) * size;
  stamp('glow', x, y, radius * 3.3, radius * 3.3, 0xffb642, alpha * .6);
  stamp('burst', x, y, radius * 2.2, radius * 2.2, 0xf48128, alpha);
  stamp('burst', x, y, radius * 1.2, radius * 1.2, 0xffed9c, alpha * alpha);
  g.fillStyle(0xfff4c4, Math.max(0, 1 - progress * 5)); g.fillCircle(x, y, .8 + progress * 3);
  g.lineStyle(.5 * alpha + .1, 0xffdc8b, alpha * .75); g.strokeCircle(x, y, radius);
  for (let i = 0; i < 7; i++) {
    const angle = i * Math.PI * 2 / 7 + noise(x + y + i), reach = radius * (1 + noise(i + x) * .45);
    const px = x + Math.cos(angle) * reach, py = y + Math.sin(angle) * reach;
    g.lineStyle(.18 + alpha * .18, 0xffc04c, alpha); g.lineBetween(px, py, px - Math.cos(angle) * 1.8 * alpha, py - Math.sin(angle) * 1.8 * alpha);
  }
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    stamp('smoke', x + Math.cos(angle) * radius * .4, y + Math.sin(angle) * radius * .3 - progress * 2, radius * 1.6, radius * 1.6, 0x6b6159, Math.sin(progress * Math.PI) * .25, angle);
  }
}

export function drawDamageEffects(w: World, g: Graphics, stamp: EffectStamp) {
  for (const f of w.fields) {
    const alpha = fade(f.life, .4), phase = w.time * 3 + f.x + f.y;
    if (f.kind === 'burn') fire(g, stamp, f.x, f.y, f.radius, w.time, alpha);
    else if (f.kind === 'frost') snow(g, f.x, f.y, f.radius, w.time, alpha);
    else if (f.kind === 'arc') {
      for (let i = 0; i < 3; i++) { const angle = i * 2.1 + Math.sin(phase); lightning(g, f, { x: f.x + Math.cos(angle) * f.radius, y: f.y + Math.sin(angle) * f.radius }, Math.floor(w.time * 18), alpha); }
    } else explosion(g, stamp, f.x, f.y, 1 - fade(f.life, .4), alpha, f.radius);
  }
  for (const v of w.visuals) {
    const alpha = fade(v.life, v.max), progress = 1 - alpha;
    if (v.kind === 'blast') explosion(g, stamp, v.x, v.y, progress, alpha, v.radius ?? 6);
    else if (v.kind === 'arc') { lightning(g, v, v.target!, Math.floor(progress * 6), alpha); stamp('glow', v.target!.x, v.target!.y, 4, 4, 0xb9a0ff, alpha * .65); }
    else if (v.kind === 'flame') fire(g, stamp, v.x, v.y, 2, w.time, alpha);
    else if (v.kind === 'frost') snow(g, v.x, v.y, 2.5, w.time, alpha);
  }
}
