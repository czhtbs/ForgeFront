import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { drawUnit } from '../art-preview/soldiers.js';
const { createCanvas, loadImage } = createRequire(import.meta.url)('@napi-rs/canvas');
const sharp = createRequire(import.meta.url)('sharp');
const output = new URL('../public/assets/b-style/', import.meta.url);
const source = new URL('../docs/art-direction/2026-11-game-art/source/', import.meta.url);
mkdirSync(new URL('parts/', output), { recursive: true });
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

const assets = { soldier: await loadImage(readFileSync(new URL('../art-preview/assets/soldier-v2.svg', import.meta.url))) };
const frames = JSON.parse(readFileSync(new URL('../art-preview/soldier-frames.json', import.meta.url)));
const weapons = ['none', 'rifle', 'mg', 'sniper', 'rocket', 'flame'];
const soldiers = createCanvas(24 * 160, 4 * 160), ctx = soldiers.getContext('2d');
for (let owner = 0; owner < 4; owner++) for (const [i, weapon] of weapons.entries()) for (let recoil = 0; recoil < 4; recoil++) {
  ctx.save(); ctx.translate((i * 4 + recoil) * 160, owner * 160);
  drawUnit(ctx, assets, frames, { weapon, x: 55, y: 80, size: 60, recoil: recoil / 3, enemy: owner === 1 });
  ctx.fillStyle = ['#65b5ba', '#d9836c', '#d7b75b', '#b2a0d0'][owner]; ctx.fillRect(40, 98, 8, 3); ctx.restore();
}
save('soldiers.png', soldiers);
const fragments = ['torso', 'helmet', 'rifle', 'mg', 'sniper', 'rocket', 'flame', 'tanks'];
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
  rifle: rect(10, 23, 17, 4, outline) + rect(23, 21, 5, 3, steel) + rect(27, 21, 3, 2, outline) + rect(12, 24, 5, 2, '#9a7351') + rect(18, 27, 3, 4, steel) + rect(22, 24, 4, 3, '#bcab81'),
  mg: rect(7, 23, 22, 5, outline) + rect(20, 22, 10, 2, steel) + rect(13, 27, 9, 6, '#b19852') + rect(15, 28, 5, 3, '#756238') + rect(23, 26, 4, 3, '#bcab81') + rect(8, 23, 7, 2, steel),
  sniper: rect(8, 23, 17, 3, outline) + rect(24, 21, 8, 2, steel) + rect(18, 19, 7, 3, outline) + rect(23, 19, 2, 2, '#8ab7b8') + rect(11, 24, 6, 2, '#85664b') + rect(20, 24, 3, 3, '#bcab81') + rect(9, 13, 6, 3, cloth),
  rocket: rect(4, 16, 25, 8, outline) + rect(7, 17, 19, 5, '#7b875b') + rect(9, 17, 11, 2, '#b0b581') + rect(25, 15, 4, 10, '#5b644b') + rect(28, 17, 3, 6, '#aeb096') + rect(13, 22, 4, 7, outline) + rect(16, 22, 5, 3, '#bcab81'),
  flame: rect(3, 17, 6, 16, outline) + rect(4, 18, 4, 12, '#b19450') + rect(4, 22, 4, 2, '#ddd096') + rect(7, 29, 8, 3, outline) + rect(13, 24, 15, 5, outline) + rect(16, 24, 10, 2, steel) + rect(26, 23, 5, 7, '#b87a3d') + rect(28, 25, 3, 3, '#edc05f') + rect(20, 26, 4, 3, '#bcab81')
};
writeFileSync(new URL('parts/body.svg', output), svg(base));
writeFileSync(new URL('parts/arms-idle.svg', output), svg(restArms));
writeFileSync(new URL('parts/arms-holding.svg', output), svg(holdingArms));
const portraits = createCanvas(32 * weapons.length, 40), pc = portraits.getContext('2d');
for (const [i, weapon] of weapons.entries()) {
  const gloves = weapon === 'none' ? '' : weapon === 'rocket' ? rect(13, 22, 4, 3, '#bcab81') + rect(22, 20, 4, 3, '#bcab81') : rect(12, 25, 4, 3, '#bcab81') + rect(22, 24, 4, 3, '#bcab81');
  writeFileSync(new URL(`parts/${weapon}.svg`, output), svg(gear[weapon] + gloves));
  pc.drawImage(await loadImage(Buffer.from(svg(base + (weapon === 'none' ? restArms : holdingArms) + gear[weapon] + gloves))), i * 32, 0);
}
save('army-portraits.png', portraits);
const modules = createCanvas(48, 12), mc = modules.getContext('2d');
const parts = [rect(5, 1, 2, 10, '#95cede') + rect(4, 2, 4, 3, '#95cede') + rect(3, 7, 6, 2, '#e0ddaf'), rect(3, 3, 6, 7, '#de9a49') + rect(5, 1, 3, 3, '#f1d691') + rect(1, 5, 2, 2, '#f1d691'), rect(3, 3, 7, 8, '#8fa657') + rect(5, 1, 3, 2, '#d4d498') + rect(4, 5, 5, 2, '#455b38'), rect(5, 4, 2, 7, '#c0a2d2') + rect(2, 2, 2, 5, '#c0a2d2') + rect(8, 2, 2, 5, '#c0a2d2') + rect(2, 6, 8, 2, '#c0a2d2')];
for (const [i, name] of ['pierce', 'blast', 'gas', 'split'].entries()) {
  const data = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" shape-rendering="crispEdges">${rect(0, 0, 12, 12, '#223137')}${parts[i]}</svg>`;
  writeFileSync(new URL(`parts/${name}.svg`, output), data); mc.drawImage(await loadImage(Buffer.from(data)), i * 12, 0);
}
save('equipment-modules.png', modules);
console.log('Built 8 scenery sprites, 96 infantry frames, 6 modular portraits and 4 equipment modules.');
