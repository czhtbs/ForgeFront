import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
export function simulationVersion() {
  const hash = createHash('sha256');
  for (const folder of ['src/sim', 'src/content', 'src/ai', 'src/net']) {
    for (const file of readdirSync(join(root, folder)).filter(f => f.endsWith('.ts')).sort()) {
      const path = join(root, folder, file);
      hash.update(relative(root, path).replaceAll('\\', '/')).update(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'));
    }
  }
  return hash.digest('hex').slice(0, 16);
}
