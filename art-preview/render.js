import { buildings, buildingNames } from './catalog.js';
import { drawUnit } from './soldiers.js';
import { sceneLand, drawSceneMap, drawScenery } from './scenery-map.js';
export { drawArmy, drawUnit, weaponPose } from './soldiers.js';

export const W=1200,H=600;
export function text(c,value,x,y,size=15,color='#203b3f',align='center') { c.font=`${size}px "Microsoft YaHei",sans-serif`;c.fillStyle=color;c.textAlign=align;c.fillText(value,x,y); }
export function image(c,img,frame,x,y,width,height,angle=0) {
  const f=frame??[0,0,img.width,img.height];const h=height??width*f[3]/f[2];
  c.save();c.translate(x,y);c.rotate(angle);c.drawImage(img,...f,-width/2,-h/2,width,h);c.restore();
}
function rect(c,x,y,w,h,color) { c.fillStyle=color;c.fillRect(x,y,w,h); }
function circle(c,x,y,r,color) { c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill(); }
function line(c,points,color,width=1) { c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke(); }
function polygon(c,points) { c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath(); }

export const land=sceneLand;
export function mapTransform(c,scale,panX=0,panY=0){c.translate(W/2+panX,H/2+panY);c.scale(scale,scale);c.translate(-W/2,-H/2);}
export function pickBuilding(x,y,scale=1,panX=0,panY=0){
  const px=(x-600-panX)/scale+600,py=(y-300-panY)/scale+300;
  return land.findIndex(p=>Math.abs(p.x-px)<56&&py>p.y-70&&py<p.y+30);
}
export function drawBuilding(c,a,type,x,y,size,style='current') {
  if(style==='composed')drawScenery(c,a,type,x,y+15,size);
  else image(c,a[type],null,x,y,size,size*.75);
}
export function drawMap(c,a,frames,s,time) {
  if(s.style==='composed')return drawSceneMap(c,a,frames,s,time);
  const style=s.style,scale=s.scale??1;rect(c,0,0,W,H,style==='b'?'#45616f':'#8fbac6');
  c.save();mapTransform(c,scale,s.panX??0,s.panY??0);c.imageSmoothingEnabled=true;
  for(let i=0;i<land.length;i++){
    const p=land[i];c.save();polygon(c,p.poly);c.clip();
    const color=style==='b'?['#889783','#b7aa8b','#8b9e8e'][i%3]:['#c7d7ad','#ddd0a9','#b7cca8'][i%3];rect(c,0,0,W,H,color);
    if(s.boundaries&&p.owner>=0){c.fillStyle=p.owner===0?'#298e9b25':'#c9634d33';polygon(c,p.poly);c.fill();}
    for(let j=0;j<8;j++){
      const x=p.x+Math.sin(i*5+j*13)*112,y=p.y+Math.cos(i*7+j*9)*65;
      if(Math.hypot(x-p.x,y-p.y)<48)continue;
      circle(c,x,y,6,style==='b'?'#5b705950':'#7c976465');circle(c,x+4,y-4,4,style==='b'?'#60775b65':'#87a17060');
    }
    c.restore();polygon(c,p.poly);c.strokeStyle=style==='b'?'#435952':'#627d66';c.lineWidth=.9;c.stroke();
  }
  if(s.boundaries){
    const edge=land.filter(p=>p.owner===0&&p.type);c.strokeStyle='#277a83';c.lineWidth=2.4;
    for(const p of edge){polygon(c,p.poly);c.stroke();}
    const dest=land[1];for(const from of [land[0],land[5]]){
      const bend=[(from.x+dest.x)/2,(from.y+dest.y)/2+30];line(c,[[from.x,from.y],bend,[dest.x,dest.y]],'#e2f7df',2);
      for(let j=0;j<4;j++){const progress=(time*.1+j*.25)%1;const start=progress<.5?[from.x,from.y]:bend,end=progress<.5?bend:[dest.x,dest.y],t=(progress% .5)*2;circle(c,start[0]+(end[0]-start[0])*t,start[1]+(end[1]-start[1])*t,2.6,'#fffdf0');}
    }
  }
  land.forEach((p,i)=>{
    if(s.selected===i){c.strokeStyle='#f0d17b';c.lineWidth=3;c.beginPath();c.ellipse(p.x,p.y+11,43,28,0,0,Math.PI*2);c.stroke();}
    drawBuilding(c,a,p.type,p.x,p.y,62,style,s.variant);
    if(s.boundaries&&p.owner>=0){rect(c,p.x-19,p.y-51,38,22,p.owner?'#7c453c':'#23575d');text(c,String(18+i*3),p.x,p.y-35,13,'#fff9e3');}
  });
  const p=land[6];for(let j=0;j<6;j++){
    const enemy=j>=3,x=p.x+(enemy?54:-54),y=p.y-18+j%3*17;
    drawUnit(c,a,frames,{weapon:'mg',x,y,size:12,angle:enemy?Math.PI:0,enemy,recoil:time% .25<.06?1:0});
    if(time% .25<.08)line(c,[[x+(enemy?-9:9),y],[p.x,y]],'#ffe2a1',1);
  }
  c.restore();
}

export function drawBuildings(c,a,s) {
  rect(c,0,0,1200,150,'#25383d');buildings.forEach((type,i)=>{drawBuilding(c,a,type,120+i*240,62,85,s.style,s.variant);text(c,buildingNames[i],120+i*240,130,16,'#d9e7df');});
}
