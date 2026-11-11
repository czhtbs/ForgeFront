import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { createWorld, soldier, stepWorld, allTroops } from '../src/sim/world.ts';
import { advanceAuthority } from '../src/sim/lockstep.ts';
import { encodeState, decodeState, hashState, mapData } from '../src/sim/snapshot.ts';
import { TECHNOLOGIES } from '../src/content/research.ts';
import { addBattle } from '../src/sim/combat.ts';
import { formation } from '../src/sim/spatial.ts';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = 'docs/verification/equipment-upgrade'; mkdirSync(output, { recursive: true });
const w = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal', multiplayer: true });
w.factions.forEach(f => { f.ai = false; f.gold = 5000; f.research = TECHNOLOGIES.filter(t => t.tab === 'equipment').map(t => t.id); });
const home = w.provinces[w.factions[0].hq], plot = w.provinces.find(p => p.owner === 0 && !p.building); plot.owner = 0; plot.building = 'researchLab';
const target = w.provinces.find(p => p.owner < 0), slots = formation(target, 80);
const units = Array.from({ length: 80 }, (_, i) => ({ ...soldier(w, i < 40 ? 0 : 1), position: slots[i], effects: [['blast', 'split', 'trail'], ['burn', 'pierce', 'return'], ['frost', 'bounce', 'linger'], ['arc', 'trail', 'delay']][i % 4], rangedArmor: 'rangedLight', chip: 'spread' }));
addBattle(w, target.id, units);
const site = w.provinces.find(p => p.owner === 0 && !p.building && p.id !== plot.id);
const initial = encodeState(w), map = mapData(w), frames = [], begin = performance.now();
for (let i = 0; i < 1200; i++) {
  const requests = {
    0: { type: 'research', province: plot.id, technology: 'blast1' },
    5: { type: 'build', province: site.id, building: 'barracks' },
    14: { type: 'cancelResearch', province: plot.id },
    15: { type: 'research', province: plot.id, technology: 'blast1' },
    20: { type: 'cancelBuild', province: site.id },
    21: { type: 'build', province: site.id, building: 'barracks' },
    150: { type: 'demolish', province: site.id },
    165: { type: 'cancelDemolish', province: site.id },
    180: { type: 'upgrade', province: site.id },
    195: { type: 'cancelUpgrade', province: site.id },
  };
  const commands = requests[i] ? [{ player: 0, seq: i + 1, command: requests[i] }] : [];
  frames.push(advanceAuthority(w, commands).frame);
}
const simulationMs = performance.now() - begin, expected = hashState(w);
mkdirSync('.cache', { recursive: true }); writeFileSync('.cache/equipment-replay.json', JSON.stringify({ initial, map, frames, expected }));
let restored = decodeState(initial, map);
for (const frame of frames) { const { applyFrame } = await import('../src/sim/lockstep.ts'); applyFrame(restored, frame); if (frame.tick === 599) restored = decodeState(encodeState(restored), map); }
assert.equal(hashState(restored), expected);
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/style.css"></head><body><div id="app"></div><script type="module">
import { GameUI } from '/src/ui/GameUI.ts';
import { createWorld, soldier } from '/src/sim/world.ts';
const scene={selectedUnits:new Set(), selectedRoute:-1, selectedWaypoint:-1, cancelDrag(){}, fit(){}, focus(){}};
const ui=new GameUI(scene,()=>{}), w=createWorld({seed:4521,count:40,enemies:1,difficulty:'normal'});
w.factions[0].gold=3000;
const p=w.provinces.find(p=>p.owner<0);p.owner=0;p.building='researchLab';
const unit={...soldier(w,0),effects:['burn','pierce','split','trail'],rangedArmor:'rangedHeavy',meleeArmor:'meleeLight',chip:'far',hp:136};
w.provinces[w.factions[0].hq].troops=[unit];ui.bind(w);ui.selectUnits([unit.id],false);
document.querySelector('#map').style.background='linear-gradient(135deg,#d9e5d1,#b9d8c7)';
window.fixture={w,p,ui,unit};
</script></body></html>`;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'upgrade-review', configureServer(vite) { vite.middlewares.use('/upgrade-review', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); }); } }] });
await server.listen(); const url = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } }); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url + '/upgrade-review'); await page.waitForSelector('.soldier-portrait');
  assert.equal(await page.locator('.unit-stat').first().innerText(), '血量\n200');
  assert.equal(await page.locator('.gear-slots .gear-slot').count(), 4); assert.equal(await page.locator('.mod-slots .gear-slot').count(), 3);
  const overflow = await page.locator('#sidebar').evaluate(p => p.scrollWidth > p.clientWidth); assert.equal(overflow, false);
  await page.locator('.gear-slots .gear-slot').first().focus(); await page.waitForSelector('#hover-info:not([hidden])');
  assert.match(await page.locator('#hover-info').textContent(), /护甲 30/);
  await page.screenshot({ path: output + '/unit-panel.png' });
  await page.evaluate(() => fixture.ui.select(fixture.p.id));
  assert.notEqual(await page.evaluate(() => document.activeElement?.dataset.action), 'demolish');
  assert.equal(await page.locator('.research-card').count(), 12);
  await page.locator('[data-action="research"][data-id="blast1"]').hover();
  assert.match(await page.locator('#hover-info').textContent(), /140 金 · 25 秒/);
  assert.match(await page.locator('#hover-info').textContent(), /40 → 50/);
  assert.doesNotMatch(await page.locator('.research-card').first().innerText(), /140|25/);
  await page.screenshot({ path: output + '/research-panel.png' });
  await page.locator('[data-action="research"][data-id="blast1"]').click();
  assert.equal(await page.evaluate(() => fixture.p.research.id), 'blast1'); assert.equal(await page.evaluate(() => fixture.w.factions[0].gold), 2860);
  await page.locator('[data-action="cancel-research"]').click();
  assert.equal(await page.evaluate(() => fixture.p.research), undefined); assert.equal(await page.evaluate(() => fixture.w.factions[0].gold), 3000);
  await page.locator('[data-action="research"][data-id="blast1"]').click();
  await page.locator('[data-action="research-tab"][data-id="equipment"]').click(); assert.equal(await page.locator('.research-card').count(), 9);
  await page.locator('[data-action="research"][data-id="trail"]').hover();
  assert.match(await page.locator('#hover-info').textContent(), /子弹飞行过程中/);
  assert.doesNotMatch(await page.locator('#hover-info').textContent(), /触发器|机会/);
  await page.locator('[data-action="research-tab"][data-id="general"]').click(); assert.equal(await page.locator('.research-card').count(), 9);
  await page.setViewportSize({ width: 800, height: 650 }); assert.equal(await page.locator('#sidebar').evaluate(p => p.scrollWidth > p.clientWidth), false);
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.evaluate(() => { fixture.p.building = null; fixture.ui.select(fixture.p.id); });
  const cards = await page.locator('[data-action="build"] img').evaluateAll(async images => {
    await Promise.all(images.map(img => img.decode())); return images.map(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight }));
  });
  assert.equal(cards.length, 8); assert.ok(cards.every(c => c.src.endsWith('.webp') && c.width === 600 && c.height === 300));
  await page.screenshot({ path: output + '/construction-panel.png' });
  await page.evaluate(() => { fixture.p.building = 'launcherWorks'; fixture.p.research = undefined; fixture.ui.render(true); });
  await page.locator('.choice-card img').evaluateAll(images => Promise.all(images.map(img => img.decode())));
  await page.locator('[data-action="upgrade"]').hover();
  await page.screenshot({ path: output + '/building-actions.png' });
  await page.locator('[data-action="upgrade"]').click();
  assert.equal(await page.evaluate(() => fixture.p.work.type), 'upgrade');
  await page.locator('[data-action="cancel-upgrade"]').click();
  assert.equal(await page.evaluate(() => fixture.p.work), undefined);
  await page.locator('[data-action="demolish"]').click();
  assert.equal(await page.evaluate(() => fixture.p.work.type), 'demolish');
  assert.match(await page.locator('.building-progress').textContent(), /拆除中/);
  await page.locator('[data-action="cancel-demolish"]').click();
  assert.equal(await page.evaluate(() => fixture.p.building), 'launcherWorks'); assert.equal(await page.evaluate(() => fixture.w.factions[0].gold), 2860);
  await page.evaluate(() => { fixture.p.building = null; fixture.ui.render(true); });
  await page.locator('[data-action="build"][data-id="mine"]').click();
  assert.equal(await page.evaluate(() => fixture.w.factions[0].gold), 2700);
  await page.locator('[data-action="cancel-build"]').click();
  assert.equal(await page.evaluate(() => fixture.p.building), null); assert.equal(await page.evaluate(() => fixture.w.factions[0].gold), 2860);
  const replay = await page.evaluate(async ({ initial, map, frames }) => {
    const { decodeState, encodeState, hashState } = await import('/src/sim/snapshot.ts');
    const { applyFrame } = await import('/src/sim/lockstep.ts'); let world = decodeState(initial, map);
    for (const frame of frames) { applyFrame(world, frame); if (frame.tick === 599) world = decodeState(encodeState(world), map); if (frame.hash && frame.hash !== hashState(world)) throw new Error('Replay mismatch at ' + frame.tick); }
    return hashState(world);
  }, { initial, map, frames });
  assert.equal(replay, expected);
  // Boot the real renderer as well, including the generated laboratory texture.
  await page.goto(url); await page.locator('[data-action="training"]').click();
  await page.waitForTimeout(1000); assert.equal(await page.locator('#toast').textContent(), '');
  assert.deepEqual(errors, []);
  writeFileSync(output + '/checks.json', JSON.stringify({ tests: 'Equipment UI, hover details, building cards, manual cancellations and refunds, narrow layout, real game boot, Node/Edge replay with research/construction/demolition/cancellation and mid-run restore', ticks: w.tick, simulationMs: Math.round(simulationMs), hash: expected, browser: browser.version(), units: allTroops(w).length, errors }, null, 2) + '\n');
} finally { await browser.close(); await server.close(); }
console.log('Equipment UI and 1200-tick Node/Edge replay passed.');
