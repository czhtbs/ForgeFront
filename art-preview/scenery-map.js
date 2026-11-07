import { mapLayout } from './map-layout.js';
import { drawUnit, drawHit } from './soldiers.js';

const types=['barracks','barracks','fort','workshop','hq','mine','hq','mine','fort','fort','workshop','barracks'];
const sites=[[555,384],[1014,250],[155,323],[450,145],[870,440],[800,190],[348,307],[286,165],[715,242],[689,490],[496,480],[310,440]];
export const sceneLand=mapLayout.map((p,i)=>({...p,x:sites[i][0],y:sites[i][1],type:types[i],owner:p.x<650?0:p.x>850?1:-1,variant:i===9?'round-fort':types[i]}));
export const decor=[
  ['mountains',615,120,260],['peak',836,152,133],['ridge',550,230,160],
  ['hills',437,281,206],['hills',675,471,180],
  ['rocks',785,425,96],['rocks',207,278,76],['rocks',1045,282,75],
  ['pines',358,210,100],['pines',985,365,158],
  ['trees',235,395,120],['trees',416,435,98],['trees',885,240,129],
  ['coast',970,492,220],['stream',610,235,155]
].map(([key,x,y,width])=>({key,x,y,width}));
export const marchRoute=[[382,354],[440,390],[525,430],[615,420],[680,350]];
export function marchPosition(points,distance){
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
  const total=lengths.reduce((a,b)=>a+b,0),cycle=((distance%(total*2))+total*2)%(total*2),back=cycle>total;
  let remaining=back?total*2-cycle:cycle;
  for(let i=0;i<lengths.length;i++)if(remaining<=lengths[i]||i===lengths.length-1){
    const t=remaining/lengths[i],a=points[i],b=points[i+1];return {x:a[0]+(b[0]-a[0])*t,y:a[1]+(b[1]-a[1])*t,angle:Math.atan2(b[1]-a[1],b[0]-a[0])+(back?Math.PI:0)};
  }else remaining-=lengths[i];
}
export function mapSquads(time){
  const troops=[];
  for(let i=0;i<8;i++){const p=marchPosition(marchRoute,time*11+i*18);troops.push({...p,weapon:i%3===0?'mg':'rifle',enemy:false,moving:true});}
  for(let i=0;i<6;i++)troops.push({x:385+i%3*16,y:333+Math.floor(i/3)*18,angle:0,weapon:['rifle','mg','sniper','rocket','flame','rifle'][i],enemy:false});
  for(let i=0;i<6;i++)troops.push({x:960+i%3*17,y:432+Math.floor(i/3)*17,angle:Math.PI,weapon:['rifle','sniper','mg','rocket','flame','rifle'][i],enemy:true});
  for(let i=0;i<5;i++){
    troops.push({x:674-(i%2)*17,y:295+i*17,angle:0,weapon:i===0?'sniper':'mg',enemy:false,combat:true});
    troops.push({x:805+(i%2)*16,y:295+i*17,angle:Math.PI,weapon:i===0?'sniper':'mg',enemy:true,combat:true});
  }
  return troops;
}
function polygon(c,poly){c.beginPath();poly.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();}
function stroke(c,points,color,width){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function label(c,text,x,y){c.font='13px "Microsoft YaHei",sans-serif';c.textAlign='center';c.fillStyle='#e4ede2';c.fillText(text,x,y);}
export function drawScenery(c,a,key,x,y,width,alpha=1){
  const img=a['scene-'+key],height=width*img.height/img.width;c.save();c.globalAlpha=alpha;c.drawImage(img,x-width/2,y-height*.72,width,height);c.restore();
}
function road(c,points){c.lineJoin='round';c.lineCap='round';stroke(c,points,'#59644c55',9);stroke(c,points,'#c1b598aa',5);}
const edgeKey=(a,b)=>[a,b].map(p=>p.map(n=>n.toFixed(1)).join(',')).sort().join(':');
const borders=new Map();
for(const p of sceneLand)for(let i=0;i<p.poly.length;i++){
  const a=p.poly[i],b=p.poly[(i+1)%p.poly.length],key=edgeKey(a,b),edge=borders.get(key);
  if(edge)edge.owners.push(p.owner);else borders.set(key,{a,b,owners:[p.owner]});
}
export function drawSceneMap(c,a,frames,s,time){
  const scale=s.scale??1,panX=s.panX??0,panY=s.panY??0,t=s.animate===false?0:time;
  c.fillStyle='#66838d';c.fillRect(0,0,1200,600);
  c.save();c.translate(600+panX,300+panY);c.scale(scale,scale);c.translate(-600,-300);
  // Coast, land and objects stay separate so the scene can be zoomed, selected and animated.
  for(const edge of borders.values())if(edge.owners.length===1)stroke(c,[edge.a,edge.b],'#7f9696',17);
  for(const p of sceneLand){
    polygon(c,p.poly);c.fillStyle=['#a2ac8c','#aaae91','#a0aa8a','#a8aa8b'][p.id%4];c.fill();
    c.save();c.clip();
    for(let i=0;i<350;i++){
      const x=p.x+Math.sin(i*127.1+p.id*23.3)*235,y=p.y+Math.sin(i*39.7+p.id*83.1)*160;
      c.fillStyle=i%3?'#e4e0be20':'#4b634c22';c.fillRect(x,y,1+(i%3),1);
    }
    if(s.boundaries&&p.owner>=0){c.fillStyle=p.owner===0?'#2d888e12':'#b76f5b17';c.fillRect(0,0,1200,600);}
    c.restore();
  }
  const site=id=>[sceneLand[id].x,sceneLand[id].y+15];
  const roads=[[site(2),[235,323],site(6),[458,354],site(0),site(8),[955,255],site(1)],[site(7),[321,221],site(6),[316,393],site(11),site(10),site(9),site(4)],[site(3),[493,221],site(0)],marchRoute];
  for(const points of roads)road(c,points);
  if(s.boundaries)for(const edge of borders.values()){
    if(edge.owners.length===1)stroke(c,[edge.a,edge.b],'#c3c5a5',2.2);
    else stroke(c,[edge.a,edge.b],edge.owners[0]===edge.owners[1]?'#53665355':'#37656d99',edge.owners[0]===edge.owners[1]?.7:1.8);
  }
  for(const object of decor.filter(d=>['hills','coast','stream'].includes(d.key)))drawScenery(c,a,object.key,object.x,object.y,object.width,.88);
  const objects=decor.filter(d=>!['hills','coast','stream'].includes(d.key)).map(d=>({...d,kind:'decor'}));
  for(const p of sceneLand)objects.push({...p,key:p.variant,width:p.type==='hq'?112:p.type==='workshop'?100:p.type==='barracks'?105:88,kind:'building'});
  if(s.infantry!==false)for(const soldier of mapSquads(t))objects.push({...soldier,kind:'soldier'});
  objects.sort((a,b)=>a.y-b.y);
  for(const o of objects){
    if(o.kind==='soldier'){
      const recoil=o.combat&&s.animate!==false?Math.max(0,1-(t% .65)/.10):0;
      drawUnit(c,a,frames,{...o,size:10*(s.soldierScale??1),recoil});
    }else{
      if(o.kind==='building'){
        c.fillStyle='#57664a30';c.beginPath();c.ellipse(o.x,o.y+8,o.width*.40,o.width*.15,0,0,Math.PI*2);c.fill();
        if(o.id===s.selected){c.strokeStyle='#f4d884';c.lineWidth=2.2;c.beginPath();c.ellipse(o.x,o.y+8,o.width*.5,o.width*.22,0,0,Math.PI*2);c.stroke();}
      }
      drawScenery(c,a,o.key,o.x,o.y,o.width);
      if(o.kind==='building'&&o.owner>=0){c.fillStyle=o.owner?'#ba7863':'#4d8b90';c.fillRect(o.x+o.width*.32,o.y+10,7,5);}
    }
  }
  if(s.infantry!==false&&s.animate!==false){
    for(let i=0;i<5;i++){
      const start=674-(i%2)*17+11,end=805+(i%2)*16-5,y=297+i*17,phase=(t+i*.11)%.65;
      if(phase<.28){const x=start+(end-start)*phase/.28;stroke(c,[[x-8,y],[x,y]],'#f7e2a9',1);}
      if(phase>.28)drawHit(c,a,end,y,phase-.28,'mg','soldier');
    }
  }
  if(s.boundaries){
    const routes=[[[450,160],[498,257],[555,402]],[[496,495],[537,468],[555,402]]];
    for(const points of routes){
      stroke(c,points,'#cbeee0aa',1.5);
      for(let i=0;i<4;i++){const p=marchPosition(points,(t*13+i*40));c.fillStyle='#f0fff0';c.beginPath();c.arc(p.x,p.y,1.7,0,Math.PI*2);c.fill();}
    }
  }
  c.restore();
  c.fillStyle='#152b33d9';c.fillRect(16,16,273,35);c.textAlign='left';c.font='14px "Microsoft YaHei",sans-serif';c.fillStyle='#dce6db';c.fillText('B 风格组合地图 · 12 地块 / 30 名步兵',29,39);
  if(s.selected>=0){const p=sceneLand[s.selected],name={hq:'总部',barracks:'兵营',workshop:'工坊',mine:'金矿',fort:'堡垒'}[p.type];
    c.fillStyle='#183038e8';c.fillRect(16,542,310,42);label(c,`已选：${name} · 人物 ${Math.round(10*(s.soldierScale??1)*scale)}px / 建筑 ${Math.round(100*scale)}px`,171,568);
  }
}
