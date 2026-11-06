import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { addBattle, reinforce } from '../src/sim/combat.ts';
import { createWorld, dispatch, soldier } from '../src/sim/world.ts';

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
  const document = { activeElement: null, querySelector: selector => elements.get(selector) };
  const listeners = new Map(), timers = [];
  const file = new URL('../src/ui/GameUI.ts', import.meta.url), exports = {};
  const code = stripTypeScriptTypes(readFileSync(file,'utf8'),{ mode:'transform' })
    .replace(/^import \{([^}]+)\} from '([^']+)';/gm, 'const {$1} = require("$2");')
    .replace('export class GameUI', 'exports.GameUI = class GameUI');
  runInNewContext(code,{ exports, require:createRequire(file), document, window:{addEventListener:(type,fn)=>listeners.set(type,fn)}, performance, setTimeout:fn=>timers.push(fn) });
  const scene = { selectedUnits:new Set(), selectedRoute:-1, selectedWaypoint:-1, fps:60, scale:new Proxy({}, {set(){throw new Error('Sidebar must not resize the map');}}), cancelDrag(){}, fit(){} };
  const ui = new exports.GameUI(scene,()=>{}), world=createWorld({seed:4521,count:12,enemies:1,difficulty:'normal'});
  const p=world.provinces.find(p=>!p.building);p.owner=0;
  ui.bind(world);ui.select(p.id);
  return { ui, world, p, scene, elements, Element, listeners, timers };
}

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


test('the map renders models only for deployed combatants and collapses them after capture', () => {
  const file=new URL('../src/render/MapScene.ts',import.meta.url),exports={},require=createRequire(file);
  const code=stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'})
    .replace("import Phaser from 'phaser';","const Phaser = require('phaser');")
    .replace(/^import \{([^}]+)\} from '([^']+)';/gm,'const {$1} = require("$2");')
    .replace('export class MapScene','exports.MapScene = class MapScene');
  runInNewContext(code,{exports,require:name=>name==='phaser'?{Scene:class{}}:require(name),performance});
  const scene=new exports.MapScene(), w=createWorld({seed:4521,count:12,enemies:1,difficulty:'normal'});
  const graphic=new Proxy({}, {get:()=>()=>graphic}),camera={zoom:1,worldView:{left:-10000,right:10000,top:-10000,bottom:10000,contains:()=>true}};
  Object.assign(scene,{world:w,ready:true,cameras:{main:camera},game:{loop:{actualFps:60}},overlay:graphic,effects:graphic,icons:graphic,buildings:w.provinces.map(()=>graphic),drawLand(){},groupIcon(){},text(){},drawDrag(){}});
  let drawn=[];scene.drawUnits=(troops,province,index)=>{drawn.push(...troops.map(s=>s.id));return index+troops.length;};
  const hq=w.provinces[w.factions[0].hq];dispatch(w,hq.id,hq.neighbors[0],1);
  scene.update();assert.equal(drawn.length,0);
  const p=w.provinces.find(p=>p.owner===-1)!,b=addBattle(w,p.id,[soldier(w,0),soldier(w,0),soldier(w,0)]);reinforce(w,b);
  drawn=[];scene.update();assert.deepEqual(drawn,b.fighters.map(s=>s.id));assert.equal(drawn.length,1);
  b.models=false;drawn=[];scene.update();assert.equal(drawn.length,0);
});
