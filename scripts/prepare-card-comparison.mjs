import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ITEMS, itemName } from '../src/content/equipment.ts';
import { BUILDING_NAMES } from '../src/sim/types.ts';

const require = createRequire(import.meta.url), sharp = require('sharp');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei');
const review = new URL('../docs/art-direction/2026-11-ui-refinement/', import.meta.url);
const original = new URL('generated-originals/', review), png = new URL('generated-png600/', review);
const production = new URL('generated-webp600/', review);
for (const dir of [original, png, production]) mkdirSync(dir, { recursive: true });
const sources = JSON.parse(readFileSync(new URL('image-sources.json', review), 'utf8'));
const keys = [...ITEMS, 'barracks', 'launcherWorks', 'attachmentWorks', 'mine'];
const rows = [];
for (const key of keys) {
  assert.ok(sources[key], `Missing generated source: ${key}`);
  const source = new URL(`${key}.png`, original); copyFileSync(sources[key], source);
  const metadata = await sharp(fileURLToPath(source)).metadata();
  assert.ok(metadata.width >= 1000 && metadata.width / metadata.height > 1.8, key);
  const resized = await sharp(fileURLToPath(source)).resize(600, 300, { fit: 'contain', background: '#eef1e3' }).png().toBuffer();
  writeFileSync(new URL(`${key}.png`, png), resized);
  await sharp(resized).webp({ quality: 82, effort: 5 }).toFile(fileURLToPath(new URL(`${key}.webp`, production)));
  const svg = readFileSync(new URL(`../public/assets/cards/${key}.svg`, import.meta.url));
  rows.push({ key, name: key in BUILDING_NAMES ? BUILDING_NAMES[key] : itemName(key), group: ITEMS.includes(key) ? '装备' : '建筑', svg: svg.length, svgGzip: gzipSync(svg, { level: 9 }).length, originalPng: statSync(source).size, png600: resized.length, webp600: statSync(new URL(`${key}.webp`, production)).size, originalWidth: metadata.width, originalHeight: metadata.height });
}
const fields = ['svg', 'svgGzip', 'originalPng', 'png600', 'webp600'];
const totals = Object.fromEntries(['全部', '装备', '建筑'].map(group => [group, Object.fromEntries(fields.map(field => [field, rows.filter(r => group === '全部' || r.group === group).reduce((sum, r) => sum + r[field], 0)]))]));
writeFileSync(new URL('card-sizes.json', review), JSON.stringify({ dimensions: '600 × 300', webpQuality: 82, totals, rows }, null, 2));
writeFileSync(new URL('card-sizes.csv', review), '\uFEFF' + ['名称,分类,SVG字节,SVG_gzip估算字节,生成原PNG字节,600x300_PNG字节,600x300_WebP_Q82字节', ...rows.map(r => [r.name, r.group, ...fields.map(f => r[f])].join(','))].join('\n'));
const size = n => `${(n / 1024).toFixed(1)} KiB`;
const table = `<table><thead><tr><th>范围</th><th>SVG</th><th>SVG gzip估算</th><th>生成原PNG</th><th>PNG 600×300</th><th>WebP 600×300</th></tr></thead><tbody>${Object.entries(totals).map(([group, values]) => `<tr><th>${group}</th>${fields.map(f => `<td>${size(values[f])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const pairs = rows.map(r => `<section><h2>${r.name}</h2><div class="pair"><figure><img loading="lazy" src="../../../public/assets/cards/${r.key}.svg"><figcaption>SVG ${size(r.svg)} · gzip估算 ${size(r.svgGzip)}</figcaption></figure><figure><img loading="lazy" src="generated-webp600/${r.key}.webp"><figcaption>生图 WebP ${size(r.webp600)} · ${r.webp600 > r.svg ? '+' : ''}${size(r.webp600 - r.svg)}</figcaption></figure></div><p>生成原图 ${r.originalWidth}×${r.originalHeight}：<a href="generated-originals/${r.key}.png">PNG ${size(r.originalPng)}</a>；同尺寸无损版本：<a href="generated-png600/${r.key}.png">600×300 PNG ${size(r.png600)}</a></p></section>`).join('');
const effects = JSON.parse(readFileSync(new URL('effects-manifest.json', review), 'utf8'));
const animations = effects.map(e => `<figure class="effect"><h3>${e.key === 'all' ? '全部配件' : itemName(e.key)}</h3><img loading="lazy" src="effect-${e.key}-poster.png" data-still="effect-${e.key}-poster.png" data-animation="${e.animation}" alt="${e.key}"><figcaption><button type="button">播放</button><a href="${e.animation}">GIF · ${size(e.bytes)} · ${e.duration}s</a></figcaption></figure>`).join('');
const style = 'body{margin:32px auto;max-width:1200px;padding:0 20px;background:#f7f8ef;color:#254b4e;font:16px/1.6 system-ui,"Microsoft YaHei"}h1{font-size:28px}h2{margin:40px 0 12px}h3{margin:8px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:10px;border-bottom:1px solid #c9d6bf;text-align:right}th:first-child{text-align:left}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;background:#edf1e3;border:1px solid #cbd7c3;border-radius:8px;overflow:hidden}img{display:block;width:100%;height:auto}figcaption{padding:10px 14px}a{color:#237c7d}p{color:#607462}.effects{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}.effect h3{padding:4px 14px}.effect figcaption{display:flex;justify-content:space-between;align-items:center}button{font:inherit;background:#fffdf4;border:1px solid #98b4a4;border-radius:5px;padding:5px 20px;color:#254b4e;cursor:pointer}@media(max-width:720px){.pair,.effects{grid-template-columns:1fr}table{font-size:11px}td,th{padding:5px}}';
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>图卡体积对比与特效动画</title><style>${style}</style><h1>SVG 与生图版 · 画质和体积对比</h1><p>当前游戏使用左侧 SVG，建筑图卡已移除底部阴影。生图版保存在本地 docs，不随游戏打包。生图版由内置 image_gen 工具制作，<a href="image-prompts.json">生成说明</a>与<a href="delay-revised-prompt.json">延时卡最终说明</a>均已保留。右侧是 600×300 WebP，质量参数 82；原始生成 PNG 和同尺寸无损 PNG 也分别保留。SVG 与 WebP 按相同显示宽度并排对照。建筑 SVG 内嵌了原建筑 PNG，因此不等同于纯矢量图。</p>${table}<p>以上为文件字节数，KiB = 1024 字节。gzip 列是本地压缩估算，只有服务器启用相应压缩才会接近该下载量。<a href="card-sizes.csv">逐项 CSV</a> · <a href="card-sizes.json">完整数据</a> · <a href="#animations">特效动画</a> · <a href="../2026-11-damage-fx/index.html">四种伤害特效前后对比</a></p>${pairs}<h2 id="animations">当前战场特效 · 动态演示</h2><p>每段由现有战斗逻辑与 MapScene 按 30 帧/秒离线生成，点击播放后循环。炸药、电弧、燃烧与冷凝已更新；留痕配燃烧剂，延时和抛射配炸药；最后一段为十三种配件全部安装。</p><div class="effects">${animations}</div><script>document.querySelectorAll('.effect button').forEach(button=>button.onclick=()=>{const image=button.closest('figure').querySelector('img'),playing=button.textContent==='停止';image.src=playing?image.dataset.still:image.dataset.animation;button.textContent=playing?'播放':'停止';});</script></html>`;
writeFileSync(new URL('comparison.html', review), html);
const canvas = createCanvas(1200, 2100), c = canvas.getContext('2d'); c.fillStyle = '#f7f8ef'; c.fillRect(0, 0, 1200, 2100); c.fillStyle = '#254b4e'; c.font = 'bold 26px Microsoft YaHei'; c.fillText('SVG 与生图版 · 相同显示尺寸', 24, 40);
for (const [i, key] of ['rifle', 'sword', 'blast', 'frost', 'barracks', 'mine'].entries()) {
  const row = rows.find(r => r.key === key), y = 65 + i * 335; c.font = 'bold 18px Microsoft YaHei'; c.fillStyle = '#254b4e'; c.fillText(row.name, 24, y + 20);
  const svg = await loadImage(await sharp(readFileSync(new URL(`../public/assets/cards/${key}.svg`, import.meta.url))).png().toBuffer()), raster = await loadImage(readFileSync(new URL(`${key}.webp`, production)));
  c.drawImage(svg, 20, y + 35, 570, 285); c.drawImage(raster, 610, y + 35, 570, 285); c.font = '14px Microsoft YaHei'; c.fillText(`SVG ${size(row.svg)}`, 24, y + 331); c.fillText(`WebP ${size(row.webp600)}`, 614, y + 331);
}
writeFileSync(new URL('comparison-overview.png', review), canvas.toBuffer('image/png'));
console.log(JSON.stringify({ total: totals, cards: rows.length, webpVersusSvg: totals['全部'].webp600 / totals['全部'].svg }, null, 2));
