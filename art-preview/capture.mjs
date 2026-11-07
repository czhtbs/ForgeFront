import { createRequire } from 'node:module';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { images } from './catalog.js';
import { drawArmy, drawMap } from './render.js';
const {createCanvas,loadImage,GlobalFonts}=createRequire(import.meta.url)('@napi-rs/canvas');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc','Microsoft YaHei');
const assets=Object.fromEntries(await Promise.all(Object.entries(images).map(async([key,path])=>[key,await loadImage(readFileSync(new URL(path,import.meta.url)))])));
const frames=JSON.parse(readFileSync(new URL('soldier-frames.json',import.meta.url)));
const base={weapon:'all',motion:'idle',inspection:'pose',target:'soldier',scale:2,dark:true,guides:false};
mkdirSync(new URL('qa/',import.meta.url),{recursive:true});
for(const [name,change,time] of [
  ['holding',{guides:true},.4],['four-directions',{inspection:'four'},.4],
  ['hit-soldier',{inspection:'impact',motion:'fire'},1.18],
  ['hit-armor',{inspection:'impact',motion:'fire',target:'armor'},.72],
  ['hit-ground',{inspection:'impact',motion:'fire',target:'ground'},.72]
]){
  const canvas=createCanvas(1800,900),ctx=canvas.getContext('2d');ctx.scale(1.5,1.5);
  drawArmy(ctx,assets,frames,{...base,...change},time);
  writeFileSync(new URL(`qa/${name}.png`,import.meta.url),canvas.toBuffer('image/png'));
  console.log(`Rendered actual preview drawing: qa/${name}.png`);
}
for(const [name,view] of [
  ['map-overview',{scale:1,panX:0,panY:0,selected:6}],
  ['map-closeup',{scale:1.8,panX:180,panY:-70,selected:0}]
]){
  const canvas=createCanvas(1800,900),ctx=canvas.getContext('2d');ctx.scale(1.5,1.5);
  drawMap(ctx,assets,frames,{style:'composed',boundaries:true,infantry:true,animate:true,soldierScale:1,...view},8.4);
  writeFileSync(new URL(`qa/${name}.png`,import.meta.url),canvas.toBuffer('image/png'));
  console.log(`Rendered assembled map: qa/${name}.png`);
}
