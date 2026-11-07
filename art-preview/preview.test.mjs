import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {images,mapStyles,weapons,nextIndex} from './catalog.js';
import {drawArmy,drawMap,drawBuildings,pickBuilding,land,weaponPose} from './render.js';
import {decor,mapSquads,marchPosition,marchRoute} from './scenery-map.js';

const dimensions=path=>{
  const data=readFileSync(new URL(path,import.meta.url));
  if(path.endsWith('.png'))return {width:data.readUInt32BE(16),height:data.readUInt32BE(20),path};
  const svg=data.toString(),width=Number(svg.match(/\bwidth="([\d.]+)/)?.[1]),height=Number(svg.match(/\bheight="([\d.]+)/)?.[1]);
  const box=svg.match(/viewBox="([^"]+)"/)?.[1].split(/[ ,]+/).map(Number);
  return {width:width||box?.[2]||300,height:height||box?.[3]||150,path};
};
const assets=Object.fromEntries(Object.entries(images).map(([key,path])=>[key,dimensions(path)]));
const frames=JSON.parse(readFileSync(new URL('soldier-frames.json',import.meta.url)));
let calls=0;
const context=new Proxy({}, {get:(_target,key)=>key==='drawImage'?(img,...args)=>{
  assert.ok(img,'image exists');assert.ok(args.every(Number.isFinite),'finite draw coordinates');
  if(args.length===8){const [x,y,w,h]=args;assert.ok(x>=0&&y>=0&&w>0&&h>0&&x+w<=img.width&&y+h<=img.height,`${img.path}: source rect ${[x,y,w,h]}`);}
  calls++;
}:()=>{},set:()=>true});

test('all runtime assets and generated sprite rectangles exist within their images',()=>{
  for(const [key,path] of Object.entries(images)){assert.ok(existsSync(new URL(path,import.meta.url)));assert.ok(assets[key].width>0&&assets[key].height>0);}
  for(const box of Object.values(frames))context.drawImage(assets.soldier,...box,0,0,36,36);
  assert.deepEqual(Object.keys(frames),['torso','helmet','pack','rifle','mg','sniper','rocket','flame','tanks']);
});
test('weapon recoil moves both grip points and muzzle together, preserving contact',()=>{
  for(const weapon of weapons.filter(w=>w!=='none')){
    const before=weaponPose(weapon,0),after=weaponPose(weapon,1);
    for(const key of ['near','far','muzzle']){
      assert.ok(Math.abs(before[key][0]-after[key][0]-1.8)<1e-10);
      assert.equal(before[key][1],after[key][1]);
    }
    for(const point of [before.near,before.far])assert.ok(point[0]>before.left&&point[0]<before.muzzle[0]);
    assert.ok(before.flight>0);
  }
});
test('all weapons, four directions and hit materials complete finite drawing passes',()=>{
  for(const weapon of [...weapons,'all'])for(const inspection of ['pose','four','impact'])for(const target of ['soldier','armor','ground']){
    for(const time of [.03,.38,.72,1.18])drawArmy(context,assets,frames,{weapon,inspection,target,motion:'fire',scale:2,dark:true,guides:true},time);
  }
  assert.ok(calls>1000);
});
test('all map candidates draw and building selection follows the same zoom transform',()=>{
  for(const [style] of mapStyles)for(let variant=0;variant<5;variant++){
    drawMap(context,assets,frames,{style,variant,scale:1.65,boundaries:true,selected:1},1.4);
    drawBuildings(context,assets,{style,variant});
  }
  for(const scale of [1,1.65])land.forEach((p,i)=>assert.equal(pickBuilding((p.x-600)*scale+600,(p.y-300)*scale+300,scale),i));
  assert.equal(pickBuilding(-200,-200),-1);assert.equal(nextIndex(0,-1,4),3);assert.equal(nextIndex(3,1,4),0);
  for(const scale of [1,1.8])land.forEach((p,i)=>assert.equal(pickBuilding((p.x-600)*scale+780,(p.y-300)*scale+230,scale,180,-70),i));
});

test('assembled scene has sourced terrain, all weapon classes, and continuous marching',()=>{
  assert.equal(land.length,12);assert.ok(land.every(p=>p.neighbors.length>0));
  for(const object of decor)assert.ok(assets['scene-'+object.key]);
  for(const p of land)assert.ok(assets['scene-'+p.variant]);
  for(const time of [0,4,15,60]){
    const troops=mapSquads(time);assert.equal(troops.length,30);
    assert.ok(troops.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.y)&&Number.isFinite(s.angle)));
    for(const weapon of weapons.filter(w=>w!=='none'))assert.ok(troops.some(s=>s.weapon===weapon));
  }
  for(const d of [0,75,220,400,800]){
    const a=marchPosition(marchRoute,d),b=marchPosition(marchRoute,d+.1);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<=.101);
  }
});

test('preview boots and real handlers switch modules, show sources, upgrade once and explain supply failures',async()=>{
  const elements=new Map();
  class Element {
    hidden=false;value='';textContent='';style={};clientWidth=1200;width=1200;height=600;dataset={};
    set innerHTML(html){this.markup=html;for(const match of html.matchAll(/id="([^"]+)"/g))if(!elements.has(match[1]))elements.set(match[1],new Element());}
    get innerHTML(){return this.markup??'';}
    getContext(){return context;}
    getBoundingClientRect(){return {width:1200,height:600,left:0,top:0};}
    setAttribute(name,value){this[name]=value;}
    addEventListener(){}
    showModal(){this.open=true;}
    close(){this.open=false;}
  }
  const html=readFileSync(new URL('index.html',import.meta.url),'utf8');
  for(const match of html.matchAll(/id="([^"]+)"/g))elements.set(match[1],new Element());
  elements.get('scale').value='2';elements.get('map-scale').value='1';
  const modules=['army','ui','map'].map(module=>Object.assign(new Element(),{dataset:{module}}));
  const callbacks=[];
  const replacements={document:{getElementById:id=>elements.get(id),querySelectorAll:()=>modules},window:{addEventListener(){}},location:{search:''},devicePixelRatio:1,requestAnimationFrame:fn=>callbacks.push(fn),fetch:async()=>({json:async()=>frames}),Image:class{set src(path){Object.assign(this,dimensions(path));queueMicrotask(()=>this.onload());}}};
  const originals=Object.fromEntries(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  try{
    for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    await import('./preview.js');
    assert.equal(elements.get('loading').hidden,true);assert.equal(callbacks.length,1);
    for(const [moduleIndex,count] of [[0,1],[1,2],[2,3]]){
      modules[moduleIndex].onclick();
      for(let i=0;i<count;i++){
        elements.get('candidate').onchange({target:{value:String(i)}});callbacks.shift()(performance.now()+1000);
        elements.get('show-source').onclick();assert.equal(elements.get('source-dialog').open,true);elements.get('close-source').onclick();
      }
    }
    modules[1].onclick();elements.get('reset-ui').onclick();
    elements.get('building-content').onclick({target:{closest:()=>({})}});
    assert.equal(elements.get('gold').textContent,660);assert.match(elements.get('level').textContent,/3/);
    elements.get('status').onchange({target:{value:'cut'}});assert.match(elements.get('building-content').innerHTML,/供给中断/);
    elements.get('close-inspector').onclick();assert.equal(elements.get('inspector').hidden,true);
    elements.get('select-barracks').onclick();assert.equal(elements.get('inspector').hidden,false);
  }finally{for(const [key,descriptor] of Object.entries(originals))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});
