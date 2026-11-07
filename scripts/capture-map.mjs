import assert from 'node:assert/strict';
import {createRequire,stripTypeScriptTypes} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createWorld,connect,reroute,soldier,stepWorld} from '../src/sim/world.ts';
import {addBattle} from '../src/sim/combat.ts';
import {mapBounds} from '../src/sim/map.ts';
import {toWorld} from '../src/sim/spatial.ts';
const req=createRequire(import.meta.url),{createCanvas,loadImage,GlobalFonts}=req('@napi-rs/canvas');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc','Microsoft YaHei');
globalThis.OffscreenCanvas=class{constructor(w,h){return createCanvas(w,h);}};
const textures={};
for(const k of ['hq','barracks','workshop','mine','fort','pine','tree','mountain','soldiers','army-portraits','equipment-modules','soldier-debris'])textures[k]=await loadImage(readFileSync(new URL(`../public/assets/b-style/${k}.png`,import.meta.url)));
const file=new URL('../src/render/MapScene.ts',import.meta.url),exports={};let now=10000;
const code=stripTypeScriptTypes(readFileSync(file,'utf8'),{mode:'transform'}).replace("import Phaser from 'phaser';","const Phaser = require('phaser');").replace(/^import \{([^}]+)\} from '([^']+)';/gm,'const {$1} = require("$2");').replace('export class MapScene','exports.MapScene = class MapScene');
runInNewContext(code,{exports,performance:{now:()=>now},require:n=>n==='phaser'?{Scene:class{},Math:{Vector2:class{constructor(x,y){this.x=x;this.y=y;}}}}:createRequire(file)(n)});
const color=n=>'#'+n.toString(16).padStart(6,'0');
function fixture(world){
 const scene=new exports.MapScene(),objects=[];
 const object=(type,props={})=>{const o={type,x:0,y:0,sx:1,sy:1,ox:.5,oy:.5,rotation:0,alpha:1,visible:true,depth:0,frame:0,...props};
 const setters={setPosition:(x,y)=>Object.assign(o,{x,y}),setScale:(x,y=x)=>Object.assign(o,{sx:x,sy:y}),setDisplaySize:(w,h)=>Object.assign(o,{w,h}),setOrigin:(x,y=x)=>Object.assign(o,{ox:x,oy:y}),setAlpha:a=>o.alpha=a,setRotation:a=>o.rotation=a,setDepth:d=>o.depth=d,setVisible:v=>o.visible=v,setTexture:k=>o.texture=k,setFrame:f=>o.frame=f,setText:t=>o.text=t,setColor:c=>o.color=c,setFontSize:s=>o.fontSize=s,clearTint:()=>{},destroy:()=>o.visible=false};
 for(const [name,fn]of Object.entries(setters))o[name]=(...args)=>{fn(...args);return o;};objects.push(o);return o;};
 const graphics=()=>{const o=object('graphics',{ops:[]});o.clear=()=>{o.ops=[];return o;};const proxy=new Proxy(o,{get:(obj,key)=>key in obj?(typeof obj[key]==='function'? (...args)=>{obj[key](...args);return proxy;}:obj[key]):(...args)=>{o.ops.push([key,args]);return proxy;}});return proxy;};
 const camera={width:1500,height:900,zoom:1,setZoom(z){this.zoom=z;return this;},centerOn(x,y){this.cx=x;this.cy=y;return this;},get worldView(){return {left:this.cx-this.width/this.zoom/2,right:this.cx+this.width/this.zoom/2,top:this.cy-this.height/this.zoom/2,bottom:this.cy+this.height/this.zoom/2};}};
 Object.assign(scene,{ready:true,land:graphics().setDepth(.5),overlay:graphics().setDepth(1),stains:graphics().setDepth(1.2),effects:graphics().setDepth(5),commands:graphics().setDepth(5.5),icons:graphics().setDepth(6),cameras:{main:camera},game:{loop:{actualFps:60}},textures:{remove:k=>delete textures[k],createCanvas:(k,w,h)=>{const c=createCanvas(w,h);return {getContext:()=>c.getContext('2d'),refresh(){textures[k]=c;}};}},add:{image:(x,y,texture)=>object('image',{x,y,texture}),container:(x,y,children)=>{children.forEach(c=>c.parent=true);return object('container',{x,y,children});},text:(x,y,text,style)=>object('text',{x,y,text,...style})}});
 scene.reset(world);scene.selected=world.factions[0].hq;
 const canvas=createCanvas(1500,900),ctx=canvas.getContext('2d');
 function path(points,close=true){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(close)ctx.closePath();}
 function draw(o){if(!o.visible||o.alpha===0)return;ctx.save();ctx.translate(o.x,o.y);ctx.rotate(o.rotation);ctx.scale(o.sx,o.sy);ctx.globalAlpha*=o.alpha;
 if(o.type==='image'){const im=textures[o.texture];const frameSize={'soldiers':[160,160],'army-portraits':[32,40],'equipment-modules':[12,12],'soldier-debris':[96,96]}[o.texture];const [fw,fh]=frameSize??[im.width,im.height],w=o.w??fw,h=o.h??fh;const columns=im.width/fw;ctx.imageSmoothingEnabled=!['army-portraits','equipment-modules'].includes(o.texture);ctx.drawImage(im,o.frame%columns*fw,Math.floor(o.frame/columns)*fh,fw,fh,-o.ox*w,-o.oy*h,w,h);}
 if(o.type==='container')for(const child of o.children)draw(child);
 if(o.type==='text'){ctx.font=`${o.fontSize||14}px Microsoft YaHei`;const width=ctx.measureText(o.text).width+6,height=(parseInt(o.fontSize)||14)+6;ctx.fillStyle=o.backgroundColor??'#fffdf1';ctx.fillRect(-width/2,-height/2,width,height);ctx.fillStyle=o.color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(o.text,0,0);}
if(o.type==='graphics')for(const [name,a]of o.ops){switch(name){case 'fillStyle':ctx.fillStyle=color(a[0]);ctx.globalAlpha=(a[1]??1)*o.alpha;break;case 'lineStyle':ctx.lineWidth=a[0];ctx.strokeStyle=color(a[1]);ctx.globalAlpha=(a[2]??1)*o.alpha;break;case 'fillPoints':path(a[0],a[1]);ctx.fill();break;case 'strokePoints':path(a[0],a[1]??false);ctx.stroke();break;case 'fillRect':ctx.fillRect(...a);break;case 'fillRoundedRect':ctx.beginPath();ctx.roundRect(...a);ctx.fill();break;case 'strokeRoundedRect':ctx.beginPath();ctx.roundRect(...a);ctx.stroke();break;case 'fillEllipse':ctx.beginPath();ctx.ellipse(a[0],a[1],a[2]/2,a[3]/2,0,0,Math.PI*2);ctx.fill();break;case 'fillCircle':ctx.beginPath();ctx.arc(...a,0,Math.PI*2);ctx.fill();break;case 'strokeCircle':ctx.beginPath();ctx.arc(...a,0,Math.PI*2);ctx.stroke();break;case 'lineBetween':ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(a[2],a[3]);ctx.stroke();break;case 'fillTriangle':path([{x:a[0],y:a[1]},{x:a[2],y:a[3]},{x:a[4],y:a[5]}]);ctx.fill();break;case 'beginPath':ctx.beginPath();break;case 'moveTo':ctx.moveTo(...a);break;case 'lineTo':ctx.lineTo(...a);break;case 'strokePath':ctx.stroke();break;default:throw new Error('Missing graphics API '+name);}}
 ctx.restore();}
 return {scene,camera,render(name,after=()=>{}){scene.update();after();ctx.fillStyle='#58c8e5';ctx.fillRect(0,0,1500,900);ctx.save();ctx.translate(750,450);ctx.scale(camera.zoom,camera.zoom);ctx.translate(-camera.cx,-camera.cy);for(const o of objects.filter(o=>!o.parent).sort((a,b)=>a.depth-b.depth))draw(o);ctx.restore();writeFileSync(new URL(`../docs/art-direction/2026-11-soft-relief/${name}.png`,import.meta.url),canvas.toBuffer('image/png'));return canvas;}};
}
const w=createWorld({seed:4521,count:40,enemies:1,difficulty:'normal'});w.factions.forEach(f=>f.ai=false);const bounds=mapBounds(w.provinces);
w.provinces.forEach(p=>{if(p.x<bounds.x-20)p.owner=0;else if(p.x>bounds.x+130)p.owner=1;});
const home=w.provinces[w.factions[0].hq],factory=w.provinces[home.neighbors.find(n=>!w.provinces[n].building)];factory.owner=0;factory.building='workshop';
const junction=w.provinces[factory.neighbors.find(n=>n!==home.id&&!w.provinces[n].building)];junction.owner=0;
const targets=junction.neighbors.filter(n=>n!==factory.id&&n!==home.id).slice(0,2).map(id=>w.provinces[id]);
for(const target of [home,...targets]){target.owner=0;if(target!==home)target.building='barracks';connect(w,factory.id,target.id);reroute(w,w.routes.at(-1).id,[{x:junction.x,y:junction.y,province:junction.id}]);}
const view=fixture(w);view.scene.selected=factory.id;view.scene.update();now+=1000;w.time+=2;view.render('map-overview');
view.camera.setZoom(3).centerOn((factory.x+junction.x+home.x)/3,(factory.y+junction.y+home.y)/3);view.render('supply-lanes');
const end=w.provinces[junction.neighbors.find(n=>n!==factory.id&&n!==home.id)];view.render('command-arrows',()=>{view.scene.drawCommand([home,{x:home.x+120,y:home.y-15}],true);view.scene.drawCommand([factory,junction,targets[0]],false);});
const target=w.provinces[0],fighters=[];target.owner=1;target.building='workshop';
for(let i=0;i<28;i++){const u=soldier(w,i%2,i%5===0?'sniper':'mg');u.position=toWorld(target,{x:i%2?760:240,y:120+Math.floor(i/2)*22});fighters.push(u);}
addBattle(w,0,fighters);for(let i=0;i<150;i++)stepWorld(w);view.camera.setZoom(6).centerOn(target.x,target.y);view.scene.update();now+=1500;
const victim=w.battles.find(b=>b.province===0).fighters[0];victim.hp=0;victim.hitForce=1.7;victim.hitAngle=.3;stepWorld(w);
for(let i=0;i<7;i++)stepWorld(w);view.render('combat-death');assert.ok(view.scene.visibleUnits > 0);assert.ok(w.casualties.length > 0);
view.camera.setZoom(1.5);view.render('combat-overview');assert.equal(view.scene.visibleUnits,0);
const corpse=w.casualties.at(-1);view.camera.setZoom(14).centerOn(corpse.x,corpse.y);view.render('death-detail');
const large=fixture(createWorld({seed:4521,count:80,enemies:3,difficulty:'normal'}));now+=1000;large.render('map-80');
console.log('Captured real MapScene drawing: maps, supply lanes, lifted arrows and combat debris.');
