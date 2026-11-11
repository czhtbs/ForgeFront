import assert from 'node:assert/strict';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createWorld, soldier } from '../src/sim/world.ts';
import { fireAttack, stepAttacks, resolveDeaths } from '../src/sim/attacks.ts';
import { EFFECTS, itemName, ITEMS } from '../src/content/equipment.ts';
import { unitFrame } from '../src/render/art.ts';
import { SOLDIER_SIZE } from '../src/sim/spatial.ts';
import { drawTerrain, terrainCanvasSize } from '../src/render/terrain.ts';

const require = createRequire(import.meta.url), { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const sharp = require('sharp');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei');
globalThis.OffscreenCanvas = class { constructor(w, h) { return createCanvas(w, h); } };
const output = new URL('../docs/art-direction/2026-11-ui-refinement/', import.meta.url);
mkdirSync(output, { recursive: true });
const sprite = await loadImage(readFileSync(new URL('../public/assets/b-style/soldiers.png', import.meta.url)));
const particles = {}, tints = new Map();
for (const key of ['burst', 'flame', 'smoke', 'glow']) particles[key] = await loadImage(readFileSync(new URL(`../public/assets/fx/${key}.png`, import.meta.url)));
function tintedParticle(key, tint) {
  const id = `${key}:${tint}`; if (tints.has(id)) return tints.get(id);
  const image = particles[key], canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height), rgb = [tint >> 16 & 255, tint >> 8 & 255, tint & 255];
  for (let i = 0; i < pixels.data.length; i += 4) for (let j = 0; j < 3; j++) pixels.data[i + j] = pixels.data[i + j] * rgb[j] / 255;
  context.putImageData(pixels, 0, 0); tints.set(id, canvas); return canvas;
}
const file = new URL('../src/render/MapScene.ts', import.meta.url), exports = {};
const code = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' })
  .replace("import Phaser from 'phaser';", "const Phaser = require('phaser');")
  .replace(/^import \{([^}]+)\} from '([^']+)';/gm, 'const {$1} = require("$2");')
  .replace('export class MapScene', 'exports.MapScene = class MapScene');
runInNewContext(code, { exports, performance, require: name => name === 'phaser' ? { Scene: class {} } : createRequire(file)(name) });
const base = createWorld({ seed: 4521, count: 12, enemies: 1, difficulty: 'normal' });
const size = terrainCanvasSize(base.provinces), ground = createCanvas(size.width, size.height);
drawTerrain(ground.getContext('2d'), base.provinces, base.settings.seed);
const color = n => '#' + n.toString(16).padStart(6, '0');
function graphics(c) {
  return {
    fillStyle(n, alpha = 1) { c.fillStyle = color(n); c.globalAlpha = alpha; },
    lineStyle(width, n, alpha = 1) { c.lineWidth = width; c.strokeStyle = color(n); c.globalAlpha = alpha; },
    fillCircle(x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); },
    strokeCircle(x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); },
    fillEllipse(x, y, width, height) { c.beginPath(); c.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2); c.fill(); },
    fillTriangle(x1, y1, x2, y2, x3, y3) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.closePath(); c.fill(); },
    beginPath() { c.beginPath(); }, moveTo(x, y) { c.moveTo(x, y); }, lineTo(x, y) { c.lineTo(x, y); }, closePath() { c.closePath(); }, fillPath() { c.fill(); },
    lineBetween(x, y, a, b) { c.beginPath(); c.moveTo(x, y); c.lineTo(a, b); c.stroke(); },
  };
}
function snapshot(w, units, center, zoom) {
  const canvas = createCanvas(400, 230), c = canvas.getContext('2d');
  c.fillStyle = '#dce6bc'; c.fillRect(0, 0, 400, 230);
  c.translate(200, 125); c.scale(zoom, zoom); c.translate(-center.x, -center.y);
  c.drawImage(ground, 0, 0);
  for (const unit of units) {
    const frame = unitFrame(unit), columns = sprite.width / 160;
    c.save(); c.translate(unit.position.x, unit.position.y); c.rotate(unit.angle ?? 0); c.scale(SOLDIER_SIZE / 60, SOLDIER_SIZE / 60);
    c.drawImage(sprite, frame % columns * 160, Math.floor(frame / columns) * 160, 160, 160, -55, -80, 160, 160); c.restore();
  }
  const geometry = createCanvas(400, 230), lines = geometry.getContext('2d'); lines.translate(200, 125); lines.scale(zoom, zoom); lines.translate(-center.x, -center.y);
  const stampEffect = (key, x, y, width, height, tint, alpha, angle = 0) => { c.save(); c.translate(x, y); c.rotate(angle); c.globalAlpha = alpha; c.drawImage(tintedParticle(key, tint), -width / 2, -height / 2, width, height); c.restore(); };
  const scene = new exports.MapScene(); Object.assign(scene, { world: w, icons: graphics(lines), stampEffect, cameras: { main: { zoom } } });
  scene.drawAttacks();
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.drawImage(geometry, 0, 0);
  return canvas;
}
const plans = {
  rifle: { effects: [], repeat: true, times: [.1, .2, .35] },
  blast: { times: [.25, .58, .83] }, arc: { times: [.25, .5, .6] }, burn: { times: [.25, .6, 1.2] }, frost: { times: [.25, .6, 1.2] },
  pierce: { targets: [[-2, 0], [7, 0], [16, 0]], times: [.35, .55, .71] },
  bounce: { targets: [[-5, 0], [3, 6], [11, 0]], times: [.3, .47, .68] },
  split: { targets: [[12, -8], [12, 0], [12, 8]], times: [.2, .43, .64] },
  return: { targets: [[12, 7]], times: [.3, .76, 1.15] },
  homing: { targets: [[9, 0]], times: [.17, .37, .55] },
  linger: { targets: [[8, 0]], times: [.3, .65, 1.65] },
  trail: { effects: ['trail', 'burn'], targets: [[15, 0]], times: [.25, .5, .72] },
  delay: { effects: ['delay', 'blast'], times: [.3, .65, 1.7] },
  lob: { effects: ['lob', 'blast'], targets: [[70, 0]], times: [.37, .77, 1.37], zoom: 3.3 },
  all: { effects: Object.keys(EFFECTS).filter(e => !['arc', 'burn', 'frost'].includes(e)), targets: [[70, 0], [74, 6], [80, -5]], times: [.7, 1.5, 4.1], zoom: 3 },
};
const captured = new Map(), manifest = [];
for (const [key, plan] of Object.entries(plans)) {
  const w = structuredClone(base); w.provinces.forEach(p => { p.owner = 0; p.building = null; p.troops = []; p.mobile = []; });
  const p = w.provinces[0], origin = { x: p.x - 22, y: p.y + 8 };
  const source = { ...soldier(w, 0), ammo: plan.ammo ?? 'round', effects: plan.effects ?? [key], position: origin, angle: 0 };
  const targets = (plan.targets ?? [[8, 0], [13, 4], [17, -4]]).map(([x, y]) => ({ ...soldier(w, 1), position: { x: p.x + x, y: origin.y + y }, angle: Math.PI }));
  p.troops = [source, ...targets];
  if (plan.repeat) targets.forEach(unit => { unit.hp = 1000; });
  const aim = key === 'return' ? { x: p.x + 17, y: origin.y } : targets[0].position;
  fireAttack(w, source, origin, aim, plan.zoom ? null : p.id, targets[0].id);
  const center = { x: p.x + (plan.zoom ? 28 : 0), y: origin.y }, frames = [], stats = [], animation = [];
  const duration = key === 'all' ? 9 : 4;
  for (let tick = 1; tick <= duration * 30; tick++) {
    w.tick = tick; w.time = tick / 30;
    if (plan.repeat && tick % 24 === 0) fireAttack(w, source, origin, aim, p.id, targets[0].id);
    if (key === 'homing') targets[0].position.y = origin.y + Math.min(tick, 22) * .32;
    stepAttacks(w); resolveDeaths(w);
    const frame = snapshot(w, p.troops, center, plan.zoom ?? 7), context = frame.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1;
    context.fillStyle = '#f7f8ef'; context.fillRect(8, 8, 205, 25); context.fillStyle = '#254b4e'; context.font = '14px Microsoft YaHei';
    context.fillText(`${key === 'all' ? '炸药与全部配件' : itemName(key)} · ${w.time.toFixed(2)} s`, 16, 26);
    animation.push(Buffer.from(context.getImageData(0, 0, 400, 230).data));
    if (tick === Math.ceil(plan.times[frames.length] * 30)) {
      assert.ok(w.projectiles.length || w.fields.length || w.visuals.length, `${key}: no visible effect at ${w.time}`);
      frames.push(frame);
      stats.push({ seconds: w.time, projectiles: w.projectiles.length, fields: w.fields.length, visuals: w.visuals.length });
    }
  }
  const gif = await sharp(Buffer.concat(animation), { raw: { width: 400, height: 230 * animation.length, channels: 4, pageHeight: 230 } })
    .gif({ loop: 0, delay: animation.map((_, i) => i % 3 === 2 ? 40 : 30), effort: 3, dither: 0 }).toBuffer();
  const metadata = await sharp(gif, { animated: true }).metadata();
  assert.ok(metadata.pages > 10, `${key}: must contain animation frames`);
  assert.equal(metadata.delay.reduce((a, b) => a + b, 0), duration * 1000);
  writeFileSync(new URL(`effect-${key}.gif`, output), gif);
  writeFileSync(new URL(`effect-${key}-poster.png`, output), frames[1].toBuffer('image/png'));
  captured.set(key, frames); manifest.push({ key, effects: source.effects, duration, fps: 30, animation: `effect-${key}.gif`, bytes: gif.length, frames: stats });
}
function sheet(keys, title, filename) {
  const canvas = createCanvas(1240, 88 + keys.length * 290), c = canvas.getContext('2d'); c.fillStyle = '#f7f8ef'; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#254b4e'; c.font = 'bold 26px Microsoft YaHei'; c.fillText(title, 24, 39);
  c.font = '14px Microsoft YaHei'; c.fillStyle = '#65796c'; c.fillText('现有战斗逻辑与 MapScene 绘制 · 独立演示场景 · 按时间从左向右', 24, 65);
  keys.forEach((key, row) => {
    const y = 90 + row * 290, plan = plans[key]; c.font = 'bold 18px Microsoft YaHei'; c.fillStyle = '#254b4e';
    c.fillText(key === 'all' ? '炸药与全部武器配件' : itemName(key) + (key === 'trail' ? ' + 燃烧剂' : ['delay', 'lob'].includes(key) ? ' + 炸药' : ''), 24, y + 17);
    captured.get(key).forEach((frame, i) => c.drawImage(frame, 16 + i * 408, y + 30));
  });
  writeFileSync(new URL(filename, output), canvas.toBuffer('image/png'));
}
sheet(['blast', 'arc', 'burn', 'frost'], '效果配件 · 当前战场表现', 'effects-payloads.png');
sheet(['rifle'], '步枪 · 当前战场表现', 'effects-weapons.png');
sheet(['pierce', 'bounce', 'split', 'return', 'homing'], '弹道配件 · 当前战场表现', 'effects-trajectories.png');
sheet(['linger', 'trail', 'delay', 'lob', 'all'], '时序配件与全配件组合 · 当前战场表现', 'effects-timing.png');
writeFileSync(new URL('effects-manifest.json', output), JSON.stringify(manifest, null, 2));
const cards = createCanvas(1240, 1800), ctx = cards.getContext('2d'); ctx.fillStyle = '#f7f8ef'; ctx.fillRect(0, 0, 1240, 1040); ctx.fillStyle = '#254b4e'; ctx.font = 'bold 26px Microsoft YaHei'; ctx.fillText('静态生产与建造图卡', 24, 39);
const entries = [...ITEMS.map(key => [key, itemName(key)]), ['barracks', '兵营'], ['launcherWorks', '发射器工坊'], ['attachmentWorks', '配件工厂'], ['mine', '金矿']];
for (const [i, [key, name]] of entries.entries()) {
  const x = 20 + i % 4 * 305, y = 65 + Math.floor(i / 4) * 192;
  ctx.fillStyle = '#fffdf4'; ctx.fillRect(x, y, 285, 176); ctx.fillStyle = '#254b4e'; ctx.font = 'bold 17px Microsoft YaHei'; ctx.fillText(name, x + 12, y + 25);
  const image = await loadImage(await sharp(readFileSync(new URL(`../public/assets/cards/${key}.svg`, import.meta.url))).png().toBuffer()); ctx.drawImage(image, x, y + 34, 285, 142.5);
}
writeFileSync(new URL('cards-overview.png', output), cards.toBuffer('image/png'));
console.log(`Captured ${manifest.length} looping weapon/effect animations, their frame sheets and all 19 static cards.`);
