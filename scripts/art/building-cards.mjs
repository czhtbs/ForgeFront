import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { BUILDING_COST } from '../../src/sim/types.ts';

// Original illustrations are produced with image generation; this only compresses them for the UI.
const output = new URL('../../public/assets/buildings/', import.meta.url);
const originals = new URL('../../docs/art/building-cards/originals/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const kind of Object.keys(BUILDING_COST)) {
  const image = await sharp(fileURLToPath(new URL(`${kind}.png`, originals))).resize(600, 300, { fit: 'contain', background: '#e6eddb' }).webp({ quality: 86, effort: 5 }).toBuffer();
  writeFileSync(new URL(`${kind}.webp`, output), image);
}
