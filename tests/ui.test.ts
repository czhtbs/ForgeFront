import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { addBattle, reinforce } from '../src/sim/combat.ts';
import { createWorld, dispatch, soldier, connect, build, orderUnits } from '../src/sim/world.ts';
import { isWorkshop, WORKSHOP_ITEMS } from '../src/content/equipment.ts';

// Run the real UI handlers against a minimal DOM; no browser automation is needed.
function uiFixture() {
  const elements = new Map();
  class Element {
    hidden = false; writes = 0; markup = ''; listeners = new Map(); dataset = {}; disabled = false; scrollTop = 0; attributes = new Map();
    classList = { toggle() {}, remove() {} };
    listenerOptions = new Map();
    addEventListener(type, listener, options) { this.listeners.set(type, listener); this.listenerOptions.set(type, options); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    contains() { return false; }
    closest() { return this; }
    set innerHTML(value) { this.markup = value; this.writes++; }
    get innerHTML() { return this.markup; }
  }
  for (const selector of ['#app','#sidebar','#menu','#resources','#toast','#debug','#line-tools','main']) elements.set(selector,new Element());
  elements.get('#sidebar').hidden = true;
  const document = { activeElement: null, querySelector: selector => elements.get(selector), getElementById: id => elements.get('#' + id) };
  const listeners = new Map(), timers = [];
  const file = new URL('../src/ui/GameUI.ts', import.meta.url), exports = {};
  const code = stripTypeScriptTypes(readFileSync(file,'utf8'),{ mode:'transform' })
    .replace(/^import \{([^}]+)\} from '([^']+)';/gm, 'const {$1} = require("$2");')
    .replace('export class GameUI', 'exports.GameUI = class GameUI');
  runInNewContext(code,{ exports, require:createRequire(file), document, window:{addEventListener:(type,fn)=>listeners.set(type,fn)}, performance, setTimeout:fn=>timers.push(fn) });
  const scene = { selectedUnits:new Set(), selectedRoute:-1, selectedWaypoint:-1, fps:60, scale:new Proxy({}, {set(){throw new Error('Sidebar must not resize the map');}}), cancelDrag(){}, fit(){} };
  const starts = [];
  const ui = new exports.GameUI(scene,settings=>starts.push(settings)), world=createWorld({seed:4521,count:12,enemies:1,difficulty:'normal'});
  const p=world.provinces.find(p=>!p.building);p.owner=0;
  ui.bind(world);ui.select(p.id);
  return { ui, world, p, scene, elements, Element, listeners, timers, starts };
}

test('map menu offers small/medium/large and passes the chosen tile count to a new game', () => {
  const { elements, Element, starts } = uiFixture(), app = elements.get('#app');
  const button = new Element(); button.dataset = { action: 'setup' }; app.listeners.get('click')({ target: button });
  const markup = elements.get('#menu').innerHTML;
  for (const count of [40, 60, 80]) assert.match(markup, new RegExp(`value="${count}"`));
  assert.doesNotMatch(markup, /value="(?:12|48)"/);
  for (const count of [40, 60, 80]) {
    for (const [key, value] of Object.entries({ count, enemies: 1, difficulty: 'normal', seed: 4521 })) elements.set('#start-' + key, { value: String(value) });
    button.dataset = { action: 'start' }; app.listeners.get('click')({ target: button });
    assert.equal(starts.at(-1).count, count);
  }
});

test('the menu supports each AI count from one through five', () => {
  const { elements, Element, starts } = uiFixture(), app = elements.get('#app'), button = new Element();
  button.dataset = { action: 'setup' }; app.listeners.get('click')({ target: button });
  const options = elements.get('#menu').innerHTML.match(/<select id="start-enemies">(.*?)<\/select>/)[1];
  assert.deepEqual([...options.matchAll(/value="(\d+)"/g)].map(m => Number(m[1])), [1, 2, 3, 4, 5]);
  for (const enemies of [1, 2, 3, 4, 5]) {
    for (const [key, value] of Object.entries({ count: 80, enemies, difficulty: 'normal', seed: 4521 })) elements.set('#start-' + key, { value: String(value) });
    button.dataset = { action: 'start' }; app.listeners.get('click')({ target: button }); assert.equal(starts.at(-1).enemies, enemies);
  }
});

test('nonzero multiplayer seats see their resources and submit only their own building commands', () => {
  const { ui, world, elements } = uiFixture(), requests = [];
  ui.bind(world, 1); ui.send = command => { requests.push(command); return null; };
  const home = world.provinces[world.factions[1].hq]; world.factions[1].gold = 1234;
  ui.select(home.id); assert.match(elements.get('#resources').innerHTML, /1234/);
  const level = home.level; ui.action('upgrade'); assert.equal(home.level, level);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ type: 'upgrade', province: home.id }]);
  ui.select(world.factions[0].hq); ui.action('upgrade'); assert.equal(requests.length, 1);
});

test('multiplayer menu enters the lobby without advancing the local game and leaves cleanly', () => {
  const { ui, scene, elements } = uiFixture(); let entered = 0, left = 0;
  ui.network = { enter() { entered++; }, leave() { left++; } }; ui.home(); ui.enterNetwork();
  assert.equal(entered, 1); assert.equal(ui.online, true); assert.equal(ui.active, false); assert.equal(scene.enabled, false);
  assert.equal(elements.get('#menu').hidden, false); assert.match(elements.get('#menu').innerHTML, /data-network-status/);
  ui.home(); assert.equal(left, 1); assert.equal(ui.online, false); assert.equal(ui.player, 0);
});

test('building buttons survive a timed refresh between press and click and charge exactly once', () => {
  const { ui, world, p, elements, Element, listeners, timers }=uiFixture();
  const panel=elements.get('#sidebar'), app=elements.get('#app'), button=new Element();button.dataset={action:'build',id:'launcherWorks'};
  const writes=panel.writes, gold=world.factions[0].gold;
  app.listeners.get('pointerdown')({target:button});p.hp=980;ui.update(performance.now()+1000);
  assert.equal(panel.writes,writes);
  listeners.get('pointerup')();ui.update(performance.now()+2000);assert.equal(panel.writes,writes);
  app.listeners.get('click')({target:button});
  assert.equal(p.building,'launcherWorks');assert.equal(world.factions[0].gold,gold-110);
  timers.forEach(fn=>fn());ui.update(performance.now()+3000);assert.equal(world.factions[0].gold,gold-110);
});

test('unchanged panels keep their nodes and selection never resizes the map', () => {
  const { ui, p, elements }=uiFixture(), panel=elements.get('#sidebar'), writes=panel.writes;
  ui.render();ui.render();assert.equal(panel.writes,writes);
  ui.select(-1);assert.equal(panel.hidden,true);ui.select(p.id);assert.equal(panel.hidden,false);
  const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
  assert.match(css,/#sidebar\{position:absolute;/);assert.doesNotMatch(css,/main\.has-selection\{grid-template/);
});

test('the workshop lists every outgoing line and selects the exact clicked route', () => {
  const { ui, world, p, scene, elements, Element } = uiFixture();
  world.provinces.forEach(province => { province.owner = 0; province.building = 'barracks'; }); p.building = 'launcherWorks';
  for (const target of p.neighbors.slice(0, 2)) assert.equal(connect(world, p.id, target), null);
  ui.select(p.id); const html = elements.get('#sidebar').innerHTML;
  for (const route of world.routes) assert.match(html, new RegExp(`data-action="select-route" data-id="${route.id}"`));
  const button = new Element(); button.dataset = { action: 'select-route', id: String(world.routes[1].id) };
  elements.get('#app').listeners.get('click')({ target: button });
  assert.equal(scene.selectedRoute, world.routes[1].id); assert.equal(world.routes.length, 2);
  assert.match(elements.get('#sidebar').innerHTML, /aria-pressed="true"/);
});


test('the map hides unarmed groups and shows deployed models only when zoomed in', () => {
  const file=new URL('../src/render/MapScene.ts',import.meta.url),exports={},require=createRequire(file);
  const code=stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'})
    .replace("import Phaser from 'phaser';","const Phaser = require('phaser');")
    .replace(/^import \{([^}]+)\} from '([^']+)';/gm,'const {$1} = require("$2");')
    .replace('export class MapScene','exports.MapScene = class MapScene');
  runInNewContext(code,{exports,require:name=>name==='phaser'?{Scene:class{}}:require(name),performance});
  const scene=new exports.MapScene(), w=createWorld({seed:4521,count:12,enemies:1,difficulty:'normal'});
  const graphic=new Proxy({}, {get:()=>()=>graphic}),camera={zoom:1,worldView:{left:-10000,right:10000,top:-10000,bottom:10000,contains:()=>true}};
  Object.assign(scene,{world:w,ready:true,cameras:{main:camera},game:{loop:{actualFps:60}},overlay:graphic,effects:graphic,icons:graphic,commands:graphic,stains:graphic,buildings:w.provinces.map(()=>graphic),drawLand(){},groupIcon(){},text(){},drawDrag(){}});
  let drawn=[];scene.drawUnits=(troops,province,index)=>{drawn.push(...troops.map(s=>s.id));return index+troops.length;};
  const hq=w.provinces[w.factions[0].hq];dispatch(w,hq.id,hq.neighbors[0],1);
  const naked = { ...soldier(w, 0), recruit: true, weapon: null, ammo: null }; hq.troops.push(naked);
  scene.update();assert.equal(drawn.length,0);
  assert.ok(scene.groupHits.every(hit => !hit.ids.includes(naked.id)));
  const p=w.provinces.find(p=>p.owner===-1)!,b=addBattle(w,p.id,[soldier(w,0),soldier(w,0),soldier(w,0)]);reinforce(w,b);
  drawn=[];scene.update();assert.equal(drawn.length,0);
  camera.zoom=4;scene.update();assert.deepEqual(drawn,b.fighters.map(s=>s.id));assert.equal(drawn.length,1);
  b.models=false;drawn=[];scene.update();assert.equal(drawn.length,0);
});

test('barracks sidebar only shows health, troop count and all recruits eligible for equipment', () => {
  const { ui, world, p, elements } = uiFixture(); p.building = 'barracks';
  p.troops = [{ ...soldier(world, 0), recruit: true, weapon: null, ammo: null }, { ...soldier(world, 0, 'launcher'), recruit: true }, { ...soldier(world, 0, 'launcher'), effects: ['burn'], recruit: true }];
  ui.render(); const panel = elements.get('#sidebar').innerHTML;
  assert.match(panel, /血量/); assert.match(panel, /部队<\/span><b>3/); assert.match(panel, /可装备<\/span><b>3/);
  assert.doesNotMatch(panel, /驻留兵种|肉人|补装|青岚|building-portrait|data-action="tab"|件\/秒|秒生成/);
  assert.match(elements.get('#resources').innerHTML, /军队 <b>42<\/b>/);
  ui.select(-1); assert.equal(elements.get('#sidebar').hidden, true);
});

test('construction and production use complete static image cards instead of dropdowns', () => {
  const { ui, world, p, elements } = uiFixture();
  const expected = { launcherWorks: ['rifle', 'sword'], attachmentWorks: WORKSHOP_ITEMS.attachmentWorks };
  const markup = elements.get('#sidebar').innerHTML;
  for (const kind of Object.keys(WORKSHOP_ITEMS)) assert.ok(markup.includes(`data-id="${kind}"`));
  assert.ok(!markup.includes('data-id="workshop"'));
  assert.ok(!markup.includes('ammoWorks'));
  assert.equal([...markup.matchAll(/class="choice-card"/g)].length, 4);
  assert.doesNotMatch(markup, /<select/);
  world.settings.training = true;
  for (const kind of Object.keys(WORKSHOP_ITEMS)) {
    p.building = null; assert.equal(build(world, p.id, kind), null); ui.select(p.id);
    const html = elements.get('#sidebar').innerHTML;
    const options = [...html.matchAll(/data-action="factory-output" data-id="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(options, expected[kind]); assert.doesNotMatch(html, /<select|building-portrait|assets\/b-style\/workshop.png/);
    for (const item of options) assert.ok(html.includes(`assets/cards/${item}.svg`));
  }
});

test('barracks keeps selectable route numbers without descriptions', () => {
  const { ui, world, p, elements } = uiFixture();
  world.provinces.forEach(q => q.owner = 0); p.building = 'barracks';
  const target = world.provinces[p.neighbors[0]]; target.building = 'barracks';
  assert.equal(connect(world, p.id, target.id), null); ui.select(p.id);
  const html = elements.get('#sidebar').innerHTML;
  assert.doesNotMatch(html, /停止本地装配|肉人|随线中转|来自|送往/);
  assert.equal([...html.matchAll(/data-action="select-route"/g)].length, 1);
});

test('upgrade is beside the title, disabled without gold, and charges once without changing tabs', () => {
  const { ui, world, p, elements, Element } = uiFixture(); p.building = 'barracks';
  world.factions[0].gold = 99; ui.render();
  const panel = elements.get('#sidebar');
  assert.match(panel.innerHTML, /class="upgrade" data-action="upgrade" disabled/);
  assert.ok(panel.innerHTML.indexOf('data-action="upgrade"') < panel.innerHTML.indexOf('血量'));
  const button = new Element(); button.dataset = { action: 'upgrade' }; button.disabled = true;
  elements.get('#app').listeners.get('click')({ target: button }); assert.equal(p.level, 1);
  world.factions[0].gold = 100; ui.render(); assert.doesNotMatch(panel.innerHTML, /data-action="upgrade" disabled/);
  button.disabled = false; elements.get('#app').listeners.get('click')({ target: button });
  assert.equal(p.level, 2); assert.equal(world.factions[0].gold, 0);
  p.level = 5; ui.render(); assert.match(panel.innerHTML, /data-action="upgrade" disabled/);
});

test('clicking a production card updates output and preserves the scrolled list', () => {
  const { ui, world, p, elements, Element } = uiFixture(); p.building = 'launcherWorks';
  ui.render(); const panel = elements.get('#sidebar'); panel.scrollTop = 340;
  const button = new Element(); button.dataset = { action: 'factory-output', id: 'sword' };
  elements.get('#app').listeners.get('click')({ target: button });
  assert.equal(p.output, 'sword'); assert.equal(panel.scrollTop, 340);
  assert.match(panel.innerHTML, /data-id="sword" aria-pressed="true"/);
  for (const item of [...Object.values(WORKSHOP_ITEMS).flat(), 'barracks', 'launcherWorks', 'attachmentWorks', 'mine']) {
    const svg = readFileSync(new URL(`../public/assets/cards/${item}.svg`, import.meta.url), 'utf8');
    assert.match(svg, /<svg/); assert.doesNotMatch(svg, /<animate|<script|<text/);
    const image = readFileSync(new URL(`../docs/art-direction/2026-11-ui-refinement/generated-webp600/${item}.webp`, import.meta.url));
    assert.equal(image.toString('ascii', 0, 4), 'RIFF'); assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  }
});

test('menus and in-match panels contain no instructional prose and feedback is nonverbal', () => {
  const { ui, p, elements } = uiFixture();
  ui.home(); assert.doesNotMatch(elements.get('#menu').innerHTML, /肉人|连线|库存|占领/);
  assert.doesNotMatch(elements.get('#app').innerHTML, /map-help|拖动|滚轮/);
  ui.active = true;
  for (const building of ['hq', 'barracks', 'launcherWorks', 'attachmentWorks', 'mine', null]) {
    p.building = building; if (building === 'attachmentWorks') p.output = 'blast'; else p.output = 'rifle';
    ui.select(p.id);
    assert.doesNotMatch(elements.get('#sidebar').innerHTML, /class="muted"|军团|每 .*秒|无连接|首次|先选中|完整配置|停止本地/);
  }
  ui.report(null); assert.equal(elements.get('#toast').textContent, undefined);
  ui.report('武器冲突'); assert.equal(elements.get('#toast').textContent, '×');
  assert.equal(elements.get('#toast').attributes.get('aria-label'), '武器冲突');
});

function mapFixture() {
  const file = new URL('../src/render/MapScene.ts', import.meta.url), exports = {}, require = createRequire(file);
  const code = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' })
    .replace("import Phaser from 'phaser';", "const Phaser = require('phaser');")
    .replace(/^import \{([^}]+)\} from '([^']+)';/gm, 'const {$1} = require("$2");')
    .replace('export class MapScene', 'exports.MapScene = class MapScene');
  runInNewContext(code, { exports, require: name => name === 'phaser' ? { Scene: class {}, Textures: { FilterMode: { NEAREST: 0 } }, Math: { Clamp: (n, min, max) => Math.max(min, Math.min(max, n)) } } : require(name), performance });
  const scene = new exports.MapScene(), w = createWorld({ seed: 4521, count: 12, enemies: 1, difficulty: 'normal' }), orders = [], links = [];
  w.provinces.forEach(p => { p.owner = 0; p.building = null; });
  const camera = { zoom: 1, scrollX: 0, scrollY: 0, getWorldPoint(x, y) { return { x: x / this.zoom + this.scrollX, y: y / this.zoom + this.scrollY }; } };
  Object.assign(scene, { world: w, enabled: true, cameras: { main: camera }, actions: {
    select(id) { scene.selected = id; scene.selectedUnits.clear(); },
    selectUnits(ids, additive, province = -1) {
      if (additive) { const remove = ids.every(id => scene.selectedUnits.has(id)); for (const id of ids) if (remove) scene.selectedUnits.delete(id); else scene.selectedUnits.add(id); }
      else scene.selectedUnits = new Set(ids);
      scene.selected = province;
    },
    order: (to, ids) => orders.push({ to, ids }), connect: (from, to) => links.push({ from, to }),
  } });
  const pointer = (point, right = false, ctrl = false, shift = false) => ({ ...point, event: { ctrlKey: ctrl, shiftKey: shift, target: { closest: () => null } }, rightButtonDown: () => right, leftButtonDown: () => !right });
  return { scene, w, camera, orders, links, pointer };
}

test('context menus are cancelled in capture phase throughout the game, including overlays', () => {
  const { elements } = uiFixture(), app = elements.get('#app');
  assert.equal(app.listenerOptions.get('contextmenu'), true);
  for (const target of ['canvas', 'sidebar', 'line-tools', 'menu']) {
    const event = new Event('contextmenu', { cancelable: true }); Object.defineProperty(event, 'target', { value: target });
    app.listeners.get('contextmenu')(event); assert.equal(event.defaultPrevented, true);
  }
});

test('wheel zoom keeps the cursor anchored with the real Phaser camera, even between render frames', () => {
  const file = new URL('../node_modules/phaser/src/cameras/2d/Camera.js', import.meta.url), require = createRequire(file), module = { exports: {} };
  // Only rendering filters need a DOM; use the actual camera, matrices and projection code.
  runInNewContext(readFileSync(file, 'utf8'), { module, exports: module.exports, require: name => name === '../../gameobjects/components' ? { FilterList: class {} } : require(name) });
  const camera = new module.exports(27, 19, 1100, 720), { scene } = mapFixture(), handlers = new Map();
  Object.assign(scene, { cameras: { main: camera }, textures: { get: () => ({ setFilter() {} }) }, scale: { on() {} }, add: { graphics: () => ({ setDepth() { return this; } }) },
    input: { mouse: { disableContextMenu() {} }, on: (event, fn) => handlers.set(event, fn) }, game: { events: { on() {} }, canvas: { addEventListener() {} } }, reset() {} });
  scene.create(); scene.enabled = true;
  for (const start of [.35, .7, 2, 15, 16]) for (const pointer of [{ x: 80, y: 90 }, { x: 1070, y: 690 }, { x: 577, y: 379 }]) {
    camera.setScroll(123, -87).setZoom(start); camera.preRender();
    const anchor = camera.getWorldPoint(pointer.x, pointer.y);
    for (const dy of [-120, -120, 0, 120, 120]) {
      const previousZoom = camera.zoom; handlers.get('wheel')(pointer, [], 0, dy);
      camera.preRender(); const after = camera.getWorldPoint(pointer.x, pointer.y);
      assert.ok(Math.hypot(after.x - anchor.x, after.y - anchor.y) < .001, `${start}: ${dy} lost cursor anchor`);
      if (!dy) assert.equal(camera.zoom, previousZoom);
      assert.ok(camera.zoom >= .35 && camera.zoom <= 16);
    }
  }
  // Pan/resize may change camera properties before the next Phaser render updates its matrix.
  camera.setScroll(-90, 300).setViewport(0, 0, 850, 600).setZoom(1.7); camera.preRender();
  const expected = camera.getWorldPoint(120, 180); camera.setScroll(-50, 340);
  handlers.get('wheel')({ x: 120, y: 180 }, [], 0, -120); camera.preRender();
  const afterPan = camera.getWorldPoint(120, 180); assert.ok(Math.hypot(afterPan.x - expected.x - 40, afterPan.y - expected.y - 40) < .001);
  scene.enabled = false; const zoom = camera.zoom; handlers.get('wheel')({ x: 120, y: 180 }, [], 0, -120); assert.equal(camera.zoom, zoom);
});

test('the sword army icon uses the same portrait frame path as ranged units with no sword text overlay', () => {
  const { scene, w } = mapFixture(), frames = [], labels = [];
  const graphic = new Proxy({}, { get: () => () => graphic }); scene.icons = graphic;
  const portrait = { setFrame(frame) { frames.push(frame); } }, root = { setDepth() { return this; }, setVisible() { return this; }, setPosition() { return this; }, setScale() { return this; } };
  scene.add = { image: () => portrait, container: () => root }; scene.text = (_point, content) => labels.push(content);
  scene.groupIcon({ x: 100, y: 100 }, soldier(w, 0, 'hilt'), 12, true);
  assert.deepEqual(frames, [3]); assert.ok(labels.includes('12')); assert.ok(!labels.includes('剑'));
});

test('damage sprites are reused, culled offscreen and hidden when their effect expires', () => {
  const { scene, w, camera } = mapFixture(), sprites = [];
  const graphic = new Proxy({}, { get: () => () => graphic }); scene.icons = graphic;
  camera.worldView = { left: 0, top: 0, right: 200, bottom: 200 };
  scene.add = { image() {
    const image = { visible: true, setVisible(v) { this.visible = v; return this; } };
    for (const key of ['setDepth', 'setTexture', 'setPosition', 'setDisplaySize', 'setTint', 'setAlpha', 'setRotation']) image[key] = () => image;
    sprites.push(image); return image;
  } };
  const field = { kind: 'burn', x: 80, y: 80, radius: 4.5, life: 2, pulse: 0, damage: 1, owner: 0, province: 0 };
  w.fields = [field]; scene.drawAttacks(); const count = sprites.length; assert.equal(count, 10);
  w.time += .1; scene.drawAttacks(); assert.equal(sprites.length, count);
  field.x = 10000; scene.drawAttacks(); assert.ok(sprites.every(s => !s.visible));
  field.x = 80; scene.drawAttacks(); assert.ok(sprites.every(s => s.visible));
  w.fields = []; scene.drawAttacks(); assert.ok(sprites.every(s => !s.visible)); assert.equal(sprites.length, count);
});

test('arc projectiles use moving lightning throughout flight, including the artillery arc', () => {
  const { scene, w } = mapFixture(), calls = [];
  scene.icons = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const projectile = { id: 7, ammo: 'round', effects: ['arc'], phase: 'flight', airborne: false, origin: { x: 60, y: 80 }, aim: { x: 150, y: 80 }, x: 80, y: 80, vx: 70, vy: 0 };
  w.projectiles = [projectile]; const before = structuredClone(w); scene.drawAttacks(); assert.deepEqual(w, before);
  const first = [...calls]; assert.ok(calls.filter(c => c[0] === 'lineBetween').length > 20);
  assert.ok(!calls.some(c => c[0] === 'lineStyle' && c[2] === 0xa59bff));
  calls.length = 0; w.time += .1; scene.drawAttacks(); assert.notDeepEqual(calls, first);
  calls.length = 0; projectile.airborne = true; scene.drawAttacks();
  assert.ok(calls.filter(c => c[0] === 'lineBetween').every(c => c[2] < projectile.y && c[4] < projectile.y));
  calls.length = 0; projectile.airborne = false; projectile.effects = []; scene.drawAttacks();
  assert.equal(calls.filter(c => c[0] === 'lineBetween').length, 1);
});

test('Shift drag dispatches half, keeps the remainder in place and supports splitting a march', () => {
  const { scene, w, pointer } = mapFixture(), home = w.provinces[0], target = w.provinces[home.neighbors[0]];
  w.provinces.forEach(p => { p.troops = []; p.mobile = []; });
  home.troops = Array.from({ length: 5 }, () => soldier(w, 0)); const ids = home.troops.map(s => s.id);
  scene.actions.order = (to, chosen) => assert.equal(orderUnits(w, chosen, to), null);
  scene.groupHits = [{ point: home, province: home.id, ids, owner: 0 }];
  scene.pointerDown(pointer(home, false, false, true)); scene.pointerUp(pointer(target, false, false, true));
  assert.equal(home.troops.length, 2); assert.equal(w.shipments[0].troops.length, 3);
  assert.deepEqual([...scene.selectedUnits], ids.slice(0, 3));
  const moving = w.shipments[0]; scene.groupHits = [{ point: moving, province: -1, ids: moving.troops.map(s => s.id), owner: 0, shipment: moving.id }];
  scene.pointerDown(pointer(moving, false, false, true)); scene.pointerUp(pointer(home, false, false, true));
  assert.equal(w.shipments.length, 2); assert.equal(w.shipments.find(s => s.to === home.id).troops.length, 2);
  assert.equal(w.shipments.find(s => s.to === target.id).troops.length, 1);
  assert.equal(new Set([...home.troops, ...w.shipments.flatMap(s => s.troops)].map(s => s.id)).size, 5);
  scene.groupHits = [{ point: home, province: home.id, ids: home.troops.map(s => s.id), owner: 0 }];
  scene.pointerDown(pointer(home)); scene.pointerUp(pointer(target)); assert.equal(home.troops.length, 0);
});

test('unit clicks only select and unselected friendly groups can be dragged directly without moving other selections', () => {
  const { scene, w, orders, pointer } = mapFixture(), a = w.provinces[0], b = w.provinces[1];
  scene.groupHits = [{ point: a, province: a.id, ids: [101, 102], owner: 0 }];
  scene.pointerDown(pointer(a)); assert.equal(scene.drag.kind, 'army');
  scene.pointerUp(pointer(a)); assert.deepEqual([...scene.selectedUnits], [101, 102]); assert.equal(orders.length, 0);
  scene.pointerDown(pointer(a)); assert.equal(scene.drag.kind, 'army'); scene.pointerUp(pointer(b));
  assert.equal(orders.length, 1); assert.equal(orders[0].to, b.id); assert.deepEqual([...orders[0].ids], [101, 102]);
  scene.actions.selectUnits([999], false); scene.pointerDown(pointer(a)); scene.pointerUp(pointer(b));
  assert.equal(orders.length, 2); assert.deepEqual([...orders[1].ids], [101, 102]); assert.deepEqual([...scene.selectedUnits], [101, 102]);
  scene.groupHits[0].owner = 1; scene.pointerDown(pointer(a)); scene.pointerUp(pointer(b));
  assert.equal(orders.length, 2);
});

test('ground drags box friendly groups across provinces and marches without selecting land or enemies', () => {
  const { scene, camera, orders, pointer } = mapFixture();
  camera.zoom = 2; camera.scrollX = 50; camera.scrollY = 60;
  scene.groupHits = [
    { point: { x: 100, y: 100 }, province: 0, ids: [1, 2], owner: 0 },
    { point: { x: 150, y: 110 }, province: 1, ids: [3], owner: 0 },
    { point: { x: 160, y: 130 }, province: -1, ids: [4, 5], owner: 0, shipment: 99 },
    { point: { x: 130, y: 150 }, province: 2, ids: [6], owner: 1 },
    { point: { x: 300, y: 300 }, province: 3, ids: [7], owner: 0 },
  ];
  scene.unitHits = [{ point: { x: 120, y: 125 }, province: 0, ids: [1, 2], owner: 0 }];
  scene.selected = 0;
  scene.pointerDown(pointer({ x: 260, y: 220 })); scene.pointerUp(pointer({ x: 40, y: 40 }));
  assert.deepEqual([...scene.selectedUnits], [1, 2, 3, 4, 5]); assert.equal(scene.selected, -1); assert.equal(orders.length, 0);
  const target = scene.world.provinces[2];
  scene.pointerDown(pointer({ x: 100, y: 80 }));
  scene.pointerUp(pointer({ x: (target.x - camera.scrollX) * camera.zoom, y: (target.y - camera.scrollY) * camera.zoom }));
  assert.equal(orders.length, 1); assert.equal(orders[0].to, target.id); assert.deepEqual([...orders[0].ids], [1, 2, 3, 4, 5]);
});

test('Ctrl click still toggles groups and Ctrl box adds without toggling an already selected group', () => {
  const { scene, pointer } = mapFixture();
  scene.groupHits = [{ point: { x: 100, y: 100 }, province: 0, ids: [1, 2], owner: 0 }, { point: { x: 220, y: 100 }, province: 1, ids: [3], owner: 0 }];
  for (const point of [{ x: 100, y: 100 }, { x: 220, y: 100 }]) { scene.pointerDown(pointer(point, false, true)); scene.pointerUp(pointer(point, false, true)); }
  assert.deepEqual([...scene.selectedUnits], [1, 2, 3]);
  scene.pointerDown(pointer({ x: 50, y: 50 }, false, true)); scene.pointerUp(pointer({ x: 150, y: 150 }, false, true));
  assert.deepEqual([...scene.selectedUnits], [1, 2, 3]);
  scene.pointerDown(pointer({ x: 100, y: 100 }, false, true)); scene.pointerUp(pointer({ x: 100, y: 100 }, false, true));
  assert.deepEqual([...scene.selectedUnits], [3]);
});

test('workshops and barracks require preselection and building drags only create supply connections', () => {
  for (const building of ['launcherWorks', 'attachmentWorks', 'barracks', 'hq']) {
    const { scene, w, links, orders, pointer } = mapFixture(), a = w.provinces[0], b = w.provinces[1];
    a.building = building; b.building = 'barracks'; const start = scene.fortPoint(a), end = scene.fortPoint(b);
    scene.pointerDown(pointer(start)); scene.pointerUp(pointer(end)); assert.equal(links.length, 0); assert.equal(orders.length, 0);
    scene.pointerDown(pointer(start)); assert.equal(scene.drag.kind, 'select'); scene.pointerUp(pointer(start));
    assert.equal(scene.selected, a.id); assert.equal(links.length, 0);
    scene.pointerDown(pointer(start)); assert.equal(scene.drag.kind, 'connect'); scene.pointerUp(pointer(end));
    assert.deepEqual(links, [{ from: a.id, to: b.id }]); assert.equal(orders.length, 0);
  }
});

test('right click clears selection, right drag preserves it, and cancelled or panel releases issue no orders', () => {
  const { scene, w, orders, pointer } = mapFixture(), a = w.provinces[0], b = w.provinces[1];
  scene.groupHits = [{ point: a, province: a.id, ids: [1], owner: 0 }]; scene.actions.selectUnits([1], false, a.id);
  scene.pointerDown(pointer(a, true)); scene.pointerUp(pointer(b, true)); assert.equal(scene.selectedUnits.size, 1); assert.equal(orders.length, 0);
  scene.pointerDown(pointer(a, true)); scene.pointerUp(pointer(a, true)); assert.equal(scene.selectedUnits.size, 0); assert.equal(scene.selected, -1);
  scene.actions.selectUnits([1], false, a.id); scene.pointerDown(pointer(a)); scene.cancelDrag(); scene.pointerUp(pointer(b)); assert.equal(orders.length, 0);
  scene.pointerDown(pointer(a)); const release = pointer(b); release.event.target.closest = () => ({}); scene.pointerUp(release); assert.equal(orders.length, 0);
});

test('artillery uses the normal arrow to target a marching enemy icon at its real position', () => {
  const { scene, w, pointer } = mapFixture(), source = w.provinces[0], target = w.provinces.find(p => Math.hypot(p.x - source.x, p.y - source.y) > 130 && Math.hypot(p.x - source.x, p.y - source.y) < 250);
  w.provinces.forEach(p => { p.troops = []; p.mobile = []; });
  const gun = { ...soldier(w, 0), position: { x: source.x, y: source.y }, effects: ['lob', 'blast'] }, enemy = { ...soldier(w, 1), position: { x: target.x, y: target.y } };
  source.troops = [gun]; const icon = { x: target.x + 35, y: target.y - 25 };
  w.shipments.push({ id: w.nextId++, owner: 1, from: target.id, to: source.id, path: [target.id, source.id], leg: 0, x: target.x, y: target.y, troops: [enemy] });
  scene.groupHits = [{ point: source, province: source.id, ids: [gun.id], owner: 0 }, { point: icon, province: -1, ids: [enemy.id], owner: 1 }];
  scene.actions.order = (to, ids, point, targets) => { assert.deepEqual(point, enemy.position); assert.deepEqual([...targets], [enemy.id]); assert.equal(orderUnits(w, ids, to, 0, point, targets), null); };
  scene.pointerDown(pointer(source)); scene.pointerUp(pointer(icon));
  assert.ok(gun.bombard.targets.includes(enemy.id)); assert.equal(w.shipments.filter(s => s.owner === 0).length, 0);
});

test('artillery selection has no separate fire controls and removed weapons cannot be produced', () => {
  const { ui, world, p, elements } = uiFixture();
  const gun = { ...soldier(world, 0), effects: ['lob', 'blast'] }; p.troops = [gun];
  ui.selectUnits([gun.id], false, p.id);
  assert.doesNotMatch(elements.get('#sidebar').innerHTML, /data-action="bombard"|data-action="cease-fire"|炮击|停火/);
  p.building = 'launcherWorks'; ui.select(p.id);
  assert.doesNotMatch(elements.get('#sidebar').innerHTML, /laser|激光|beam/);
  assert.deepEqual([...elements.get('#sidebar').innerHTML.matchAll(/data-action="factory-output" data-id="([^"]+)"/g)].map(m => m[1]), ['rifle', 'sword']);
});
