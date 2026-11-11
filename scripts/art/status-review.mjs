import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createWorld, soldier } from '../../src/sim/world.ts';
import { stepAttacks, triggerEffect } from '../../src/sim/attacks.ts';
import { drawSoldierStatus, drawDamageEffects } from '../../src/render/damageEffects.ts';
import { unitFrame } from '../../src/render/art.ts';
const { createCanvas, loadImage, GlobalFonts } = createRequire(import.meta.url)('@napi-rs/canvas');
const sharp = createRequire(import.meta.url)('sharp');
GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei');
const sprite = await loadImage(readFileSync('public/assets/b-style/soldiers.png'));
const particles = {}, tints = new Map();
for (const key of ['burst', 'flame', 'smoke', 'glow']) particles[key] = await loadImage(readFileSync(new URL(`../../public/assets/fx/${key}.png`, import.meta.url)));
function tintedParticle(key, tint) {
  const id = `${key}:${tint}`; if (tints.has(id)) return tints.get(id);
  const image = particles[key], canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height), rgb = [tint >> 16 & 255, tint >> 8 & 255, tint & 255];
  for (let i = 0; i < pixels.data.length; i += 4) for (let j = 0; j < 3; j++) pixels.data[i + j] = pixels.data[i + j] * rgb[j] / 255;
  context.putImageData(pixels, 0, 0); tints.set(id, canvas); return canvas;
}
const output = 'docs/verification/equipment-upgrade'; mkdirSync(output, { recursive: true });
const color = n => '#' + n.toString(16).padStart(6, '0');
function graphics(c) {
  return {
    fillStyle(n, alpha = 1) { c.fillStyle = color(n); c.globalAlpha = alpha; },
    lineStyle(width, n, alpha = 1) { c.lineWidth = width; c.strokeStyle = color(n); c.globalAlpha = alpha; },
    fillTriangle(a,b,d,e,f,g) { c.beginPath();c.moveTo(a,b);c.lineTo(d,e);c.lineTo(f,g);c.closePath();c.fill(); },
    lineBetween(x,y,a,b) { c.beginPath();c.moveTo(x,y);c.lineTo(a,b);c.stroke(); },
    fillCircle(x,y,r) { c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill(); },
    beginPath() {c.beginPath();}, moveTo(x,y) {c.moveTo(x,y);}, lineTo(x,y) {c.lineTo(x,y);}, closePath() {c.closePath();}, fillPath() {c.fill();},
    strokeCircle(x,y,r) { c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.stroke(); },
  };
}
for (const kind of ['burn', 'frost', 'arc']) {
  const w = createWorld({seed:4521,count:40,enemies:1,difficulty:'normal'});
  w.provinces.forEach(p=>{p.owner=0;p.troops=[];p.mobile=[];});
  const s = {...soldier(w,1),hp:10000,position:{x:0,y:0},angle:0};w.provinces[0].troops=[s];
  const source={owner:0,province:0,weapon:'launcher'};
  const frames=[];
  for(let tick=0;tick<180;tick++) {
    w.tick=tick;w.time=tick/30;
    if(tick===0 || kind==='arc' && [30,60,90].includes(tick)) triggerEffect(w,source,kind,{x:0,y:0});
    if(tick>=105) s.position.x=30;
    stepAttacks(w);
    const canvas=createCanvas(300,230),c=canvas.getContext('2d');c.fillStyle='#edf2e3';c.fillRect(0,0,300,230);
    c.fillStyle='#d0ddc5';c.beginPath();c.ellipse(150,150,66,22,0,0,Math.PI*2);c.fill();
    const unit=createCanvas(160,160),u=unit.getContext('2d'),frame=unitFrame(s),cols=sprite.width/160;
    u.drawImage(sprite,frame%cols*160,Math.floor(frame/cols)*160,160,160,0,0,160,160);
    if(s.burning>0){u.globalCompositeOperation='source-atop';u.fillStyle=`rgba(0,0,0,${s.burning*.6})`;u.fillRect(0,0,160,160);}
    c.save();c.translate(150,130);c.scale(kind==='burn'?8:18,kind==='burn'?8:18);c.translate(-s.position.x,-s.position.y);
    if(kind==='burn') drawDamageEffects(w,graphics(c),(key,x,y,width,height,tint,alpha,angle=0)=>{
      c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha=alpha;c.drawImage(tintedParticle(key,tint),-width/2,-height/2,width,height);c.restore();
    });c.globalAlpha=1;
    c.drawImage(unit,s.position.x-55*2.7/60,s.position.y-80*2.7/60,160*2.7/60,160*2.7/60);
    drawSoldierStatus(graphics(c),s,w.time);c.restore();c.globalAlpha=1;
    c.font='bold 18px Microsoft YaHei';c.fillStyle='#2b5554';c.fillText(({burn:'燃烧与焦黑',frost:'寒冷与冻结',arc:'电击'})[kind],20,30);
    c.font='14px Microsoft YaHei';c.fillStyle='#748373';c.fillText(tick>=105?'脱离区域 · 恢复正常':kind==='arc'?'电击短暂闪现':kind==='frost'?`寒冷 ${Math.round(s.chill??0)}${s.frozen>0?' · 冻结':''}`:'持续暴露 · 身体逐渐烧黑',20,210);
    if(tick===85)writeFileSync(`${output}/status-${kind}.png`,canvas.toBuffer('image/png'));
    frames.push(Buffer.from(c.getImageData(0,0,300,230).data));
  }
  assert.equal(s.burning,0);assert.equal(s.frozen,0);assert.equal(s.shocked,0);
  const gif=await sharp(Buffer.concat(frames),{raw:{width:300,height:230*frames.length,channels:4,pageHeight:230}}).gif({loop:0,delay:frames.map((_,i)=>i%3===2?40:30),effort:3,dither:0}).toBuffer();
  writeFileSync(`${output}/status-${kind}.gif`,gif);
}
console.log('Rendered three 6-second soldier-status animations from simulation and renderer.');
