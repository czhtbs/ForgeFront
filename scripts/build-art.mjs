import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { drawUnit } from './art/soldiers.js';
import { FACTION_COLORS } from '../src/sim/types.ts';
import { UNIT_WEAPONS, ARMY_PORTRAITS } from '../src/render/art.ts';
const { createCanvas, loadImage } = createRequire(import.meta.url)('@napi-rs/canvas');
const sharp = createRequire(import.meta.url)('sharp');
const output = new URL('../public/assets/b-style/', import.meta.url);
const source = new URL('../docs/art-direction/2026-11-game-art/source/', import.meta.url);
mkdirSync(output, { recursive: true });
const save = (name, canvas) => writeFileSync(new URL(name, output), canvas.toBuffer('image/png'));
const buildingHits = {};
for (const name of ['hq', 'barracks', 'workshop', 'mine', 'fort', 'pine', 'tree', 'mountain']) {
  const image = await loadImage(await sharp(readFileSync(new URL(`${name}.png`, source))).png().toBuffer());
  const raw = createCanvas(image.width, image.height), c = raw.getContext('2d'); c.drawImage(image, 0, 0);
  const rgba = c.getImageData(0, 0, image.width, image.height).data;
  let minX = image.width, minY = image.height, maxX = 0, maxY = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (rgba[(y * image.width + x) * 4 + 3] > 24) { minX = Math.min(x, minX); minY = Math.min(y, minY); maxX = Math.max(x, maxX); maxY = Math.max(y, maxY); }
  const width = maxX - minX + 1, height = maxY - minY + 1, size = 256, scale = (size - 12) / Math.max(width, height);
  const sprite = createCanvas(size, size), ctx = sprite.getContext('2d');
  ctx.drawImage(raw, minX, minY, width, height, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale);
  save(`${name}.png`, sprite);
  if (['hq', 'barracks', 'workshop', 'mine', 'fort'].includes(name)) {
    const pixels = ctx.getImageData(0, 0, size, size).data, points = [];
    for (let y = 32; y <= 224; y += 24) for (let x = 32; x <= 224; x += 24) if (pixels[(y * size + x) * 4 + 3] > 220) points.push([x / size - .5, y / size - .5]);
    buildingHits[name] = points;
  }
}
writeFileSync(new URL('../src/content/building-hits.ts', import.meta.url), '// Generated from the opaque building sprites by scripts/build-art.mjs.\nexport const BUILDING_HITS: Record<string, [number, number][]> = ' + JSON.stringify(buildingHits) + ';\n');

const assets = { soldier: await loadImage(readFileSync(new URL('./art/soldier.svg', import.meta.url))) };
const frames = JSON.parse(readFileSync(new URL('./art/soldier-frames.json', import.meta.url)));
const weapons = UNIT_WEAPONS;
const soldiers = createCanvas(weapons.length * 4 * 160, FACTION_COLORS.length * 160), ctx = soldiers.getContext('2d');
for (let owner = 0; owner < FACTION_COLORS.length; owner++) for (const [i, weapon] of weapons.entries()) for (let recoil = 0; recoil < 4; recoil++) {
  ctx.save(); ctx.translate((i * 4 + recoil) * 160, owner * 160);
  drawUnit(ctx, assets, frames, { weapon, x: 55, y: 80, size: 60, recoil: recoil / 3, enemy: owner === 1 });
  ctx.fillStyle = ['#65b5ba', '#d9836c', '#d7b75b', '#b2a0d0', '#8fac69', '#d08faf'][owner]; ctx.fillRect(40, 98, 8, 3); ctx.restore();
}
save('soldiers.png', soldiers);
const fragments = ['torso', 'helmet', 'rifle', 'rocket'];
const debris = createCanvas(fragments.length * 96, 96), dc = debris.getContext('2d');
for (const [i, name] of fragments.entries()) {
  const box = frames[name], scale = 86 / Math.max(box[2], box[3]);
  dc.drawImage(assets.soldier, ...box, i * 96 + (96 - box[2] * scale) / 2, (96 - box[3] * scale) / 2, box[2] * scale, box[3] * scale);
}
save('soldier-debris.png', debris);

const svg = content => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40" shape-rendering="crispEdges">${content}</svg>`;
const rect = (x, y, w, h, color) => `<path fill="${color}" d="M${x} ${y}h${w}v${h}h-${w}z"/>`;
const outline = '#19282c', dark = '#35443a', cloth = '#78815b', light = '#a6ac79', steel = '#596b6f';
const base = [rect(7, 18, 17, 15, outline), rect(9, 16, 13, 13, cloth), rect(11, 21, 9, 9, dark), rect(11, 22, 4, 4, light), rect(17, 22, 3, 4, '#919666'), rect(10, 30, 5, 7, dark), rect(18, 30, 5, 7, dark), rect(8, 35, 7, 3, outline), rect(18, 35, 7, 3, outline), rect(10, 8, 12, 12, outline), rect(12, 11, 9, 8, '#bfae86'), rect(16, 13, 6, 3, '#4d5448'), rect(19, 13, 2, 2, '#ced5b0'), rect(8, 6, 16, 7, outline), rect(10, 3, 12, 4, outline), rect(10, 6, 12, 5, cloth), rect(12, 4, 8, 3, light), rect(7, 10, 17, 3, dark), rect(11, 10, 11, 1, light), rect(8, 15, 3, 4, dark)].join('');
const restArms = rect(6, 23, 5, 7, cloth) + rect(6, 29, 5, 4, '#bcab81') + rect(21, 23, 4, 7, cloth) + rect(21, 29, 4, 3, '#bcab81');
const holdingArms = rect(6, 21, 5, 7, cloth) + rect(8, 26, 7, 3, cloth) + rect(21, 21, 4, 7, cloth);
const gear = {
  none: '',
  sword: '<path d="M20 27L29 7 31 5 31 10 23 29Z" fill="#bacbd0" stroke="#263b41" stroke-width="1"/><path d="M23 24L30 8" stroke="#f1f7ef" stroke-width="1"/>' + rect(18, 25, 9, 3, '#c5a468') + rect(20, 28, 3, 6, '#65513d') + rect(19, 33, 5, 2, '#c5a468'),
  rifle: rect(10, 23, 17, 4, outline) + rect(23, 21, 5, 3, steel) + rect(27, 21, 3, 2, outline) + rect(12, 24, 5, 2, '#9a7351') + rect(18, 27, 3, 4, steel) + rect(22, 24, 4, 3, '#bcab81'),
  rocket: rect(4, 16, 25, 8, outline) + rect(7, 17, 19, 5, '#7b875b') + rect(9, 17, 11, 2, '#b0b581') + rect(25, 15, 4, 10, '#5b644b') + rect(28, 17, 3, 6, '#aeb096') + rect(13, 22, 4, 7, outline) + rect(16, 22, 5, 3, '#bcab81'),
};
const portraits = createCanvas(32 * ARMY_PORTRAITS.length, 40), pc = portraits.getContext('2d');
for (const [i, weapon] of ARMY_PORTRAITS.entries()) {
  const gloves = weapon === 'none' ? '' : weapon === 'rocket' ? rect(13, 22, 4, 3, '#bcab81') + rect(22, 20, 4, 3, '#bcab81') : rect(12, 25, 4, 3, '#bcab81') + rect(22, 24, 4, 3, '#bcab81');
  pc.drawImage(await loadImage(Buffer.from(svg(base + (weapon === 'none' ? restArms : holdingArms) + gear[weapon] + gloves))), i * 32, 0);
}
save('army-portraits.png', portraits);
console.log(`Built 8 scenery sprites, ${weapons.length * 4 * FACTION_COLORS.length} infantry frames and ${ARMY_PORTRAITS.length} portraits.`);
