import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { addBattle, reinforce } from '../src/sim/combat.ts';
import { createWorld, dispatch, soldier, connect } from '../src/sim/world.ts';

// Run the real UI handlers against a minimal DOM; no browser automation is needed.
function uiFixture() {
  const elements = new Map();
  class Element {
    hidden = false; writes = 0; markup = ''; listeners = new Map(); dataset = {}; disabled = false;
    classList = { toggle() {}, remove() {} };
    addEventListener(type, listener) { this.listeners.set(type, listener); }
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

test('building buttons survive a timed refresh between press and click and charge exactly once', () => {
  const { ui, world, p, elements, Element, listeners, timers }=uiFixture();
  const panel=elements.get('#sidebar'), app=elements.get('#app'), button=new Element();button.dataset={action:'build',id:'workshop'};
  const writes=panel.writes, gold=world.factions[0].gold;
  app.listeners.get('pointerdown')({target:button});p.hp=980;ui.update(performance.now()+1000);
  assert.equal(panel.writes,writes);
  listeners.get('pointerup')();ui.update(performance.now()+2000);assert.equal(panel.writes,writes);
  app.listeners.get('click')({target:button});
  assert.equal(p.building,'workshop');assert.equal(world.factions[0].gold,gold-110);
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
  world.provinces.forEach(province => { province.owner = 0; province.building = 'barracks'; }); p.building = 'workshop';
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
  const naked = { ...soldier(w, 0), recruit: true, equipped: false }; hq.troops.push(naked);
  scene.update();assert.equal(drawn.length,0);
  assert.ok(scene.groupHits.every(hit => !hit.ids.includes(naked.id)));
  const p=w.provinces.find(p=>p.owner===-1)!,b=addBattle(w,p.id,[soldier(w,0),soldier(w,0),soldier(w,0)]);reinforce(w,b);
  drawn=[];scene.update();assert.equal(drawn.length,0);
  camera.zoom=4;scene.update();assert.deepEqual(drawn,b.fighters.map(s=>s.id));assert.equal(drawn.length,1);
  b.models=false;drawn=[];scene.update();assert.equal(drawn.length,0);
});

test('barracks sidebar lists unarmed recruits and each assembled configuration separately', () => {
  const { ui, world, p, elements } = uiFixture(); p.building = 'barracks';
  p.troops = [{ ...soldier(world, 0), recruit: true, equipped: false }, { ...soldier(world, 0, 'rocket'), recruit: true, equipped: true }, { ...soldier(world, 0, 'rocket'), effects: ['gas'], recruit: true, equipped: true }];
  ui.render(); const panel = elements.get('#sidebar').innerHTML;
  assert.match(panel, /未装备肉人 1/); assert.match(panel, /驻留兵种/); assert.match(panel, /火箭筒 · 毒气/);
  assert.match(elements.get('#resources').innerHTML, /军队 <b>42<\/b>/);
  ui.select(-1); assert.equal(elements.get('#sidebar').hidden, true);
});
