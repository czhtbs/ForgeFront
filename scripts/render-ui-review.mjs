import assert from 'node:assert/strict';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createWorld, soldier } from '../src/sim/world.ts';

const file = new URL('../src/ui/GameUI.ts', import.meta.url), exports = {};
const elements = new Map();
for (const id of ['#app', '#sidebar', '#resources', '#menu', '#tutorial', 'main']) elements.set(id, { innerHTML: '', hidden: false, scrollTop: 0, addEventListener() {}, contains() { return false; }, classList: { toggle() {} } });
const document = { activeElement: null, querySelector: id => elements.get(id) };
const code = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' })
  .replace(/^import \{([^}]+)\} from '([^']+)';/gm, 'const {$1} = require("$2");')
  .replace('export class GameUI', 'exports.GameUI = class GameUI');
runInNewContext(code, { exports, document, window: { addEventListener() {} }, require: createRequire(file), performance });
const scene = { selectedUnits: new Set(), cancelDrag() {} }, ui = new exports.GameUI(scene, () => {});
const w = createWorld({ seed: 4521, count: 12, enemies: 1, difficulty: 'normal' }); ui.bind(w);
const p = w.provinces.find(p => p.owner < 0); p.owner = 0;
const panels = [];
for (const [building, gold] of [[null, 150], ['barracks', 50], ['launcherWorks', 350], ['attachmentWorks', 350]]) {
  p.building = building; p.output = building === 'attachmentWorks' ? 'pierce' : 'rifle';
  p.troops = Array.from({ length: 8 }, (_, i) => ({ ...soldier(w, 0), recruit: i < 5 }));
  w.factions[0].gold = gold; ui.select(p.id);
  panels.push(`<section class="review-panel"><aside id="sidebar">${elements.get('#sidebar').innerHTML}</aside></section>`);
}
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const output = new URL('../docs/art-direction/2026-11-ui-refinement/', import.meta.url); mkdirSync(output, { recursive: true });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><base href="../../../public/"><title>ForgeFront UI</title><style>${css}body{overflow:auto;background:#dce7d7}.review{display:flex;gap:20px;padding:24px}.review-panel{position:relative;flex:0 0 360px;height:820px}#sidebar{box-shadow:0 6px 24px #354e4822;border:1px solid #b7c9b1;border-radius:10px}.review-title{margin:24px 24px 0;font-size:24px}</style><h1 class="review-title">ForgeFront · 当前界面</h1><div class="review">${panels.join('')}</div></html>`;
const pageFile = new URL('ui-review.html', output); writeFileSync(pageFile, html);
ui.setup();
const menuFile = new URL('menu-review.html', output);
writeFileSync(menuFile, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>ForgeFront · 对局设置</title><style>${css}</style><section class="veil">${elements.get('#menu').innerHTML}</section></html>`);
// Render a static HTML artifact; the running game and the user's browser are not controlled.
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1568, height: 920 }, deviceScaleFactor: 1 });
  await page.goto(pageFile.href); await page.evaluate(() => document.fonts.ready);
  await page.locator('.choice-card img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  assert.equal(await page.locator('.upgrade:disabled').count(), 1);
  assert.equal(await page.locator('select').count(), 0);
  for (const list of await page.locator('.choice-list').all()) {
    const boxes = await list.locator('.choice-card').evaluateAll(cards => cards.map(card => { const r = card.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    assert.equal(boxes[0].y, boxes[1].y); assert.ok(boxes[1].x > boxes[0].x);
    assert.ok(boxes.every(box => box.width < 170 && box.height < 150));
  }
  assert.ok(await page.locator('#sidebar').last().evaluate(panel => panel.scrollHeight > panel.clientHeight));
  await page.screenshot({ path: fileURLToPath(new URL('ui-review.png', output)), fullPage: true });
  await page.setViewportSize({ width: 900, height: 800 }); await page.goto(menuFile.href);
  assert.equal(await page.locator('#start-enemies option').count(), 5); await page.locator('#start-enemies').selectOption('5');
  await page.screenshot({ path: fileURLToPath(new URL('menu-review.png', output)) });
} finally { await browser.close(); }
console.log('Rendered the actual GameUI markup and CSS as a static review artifact.');
