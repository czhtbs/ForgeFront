import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const sharp = createRequire(import.meta.url)('sharp');
const source = new URL('../docs/art-direction/2026-11-ui-study/samples/particle-pack/', import.meta.url);
const output = new URL('../public/assets/fx/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const [name, file] of Object.entries({ burst: 'fire_01', flame: 'flame_01', smoke: 'smoke_04', glow: 'light_01' })) {
  const target = fileURLToPath(new URL(`${name}.png`, output));
  const { data, info } = await sharp(fileURLToPath(new URL(`PNG (Transparent)/${file}.png`, source))).resize(128, 128).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // These grayscale particles store light in RGB; move it into alpha so tinting does not turn fire brown.
  for (let i = 0; i < data.length; i += 4) { data[i + 3] = Math.round(data[i + 3] * data[i] / 255); data[i] = data[i + 1] = data[i + 2] = 255; }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(target);
  const image = await sharp(target).metadata(); assert.equal(image.width, 128); assert.equal(image.hasAlpha, true);
}
copyFileSync(new URL('License.txt', source), new URL('License.txt', output));
console.log('Prepared four 128px CC0 particle textures.');
