import { visibleWeapons, weapons, weaponNames } from './catalog.js';

const gunData={
  rifle:{length:44,left:-4,axis:7,trigger:.30,support:.62,interval:.85,flight:.32},
  mg:{length:48,left:-5,axis:7,trigger:.30,support:.60,interval:.25,flight:.25},
  sniper:{length:58,left:-6,axis:7,trigger:.32,support:.60,interval:2.2,flight:.20},
  rocket:{length:49,left:-12,axis:-5,trigger:.46,support:.68,interval:2.6,flight:.65},
  flame:{length:40,left:-4,axis:9,trigger:.32,support:.62,interval:.20,flight:.12}
};
export function weaponPose(weapon,recoil=0){
  const g=gunData[weapon],left=g.left-recoil*1.8;
  return {...g,left,near:[left+g.length*g.trigger,g.axis+2],far:[left+g.length*g.support,g.axis-1],muzzle:[left+g.length,g.axis]};
}
function img(c,image,f,x,y,w,h,alpha=1){c.save();c.globalAlpha=alpha;c.drawImage(image,...f,x-w/2,y-h/2,w,h);c.restore();}
function part(c,a,f,key,x,y,w,h){const box=f[key];img(c,a.soldier,box,x,y,w,h??w*box[3]/box[2]);}
function circle(c,x,y,r,color){c.fillStyle=color;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();}
function line(c,points,color,width){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function label(c,value,x,y,size=15,color='#d5e4df',align='center'){c.font=`${size}px "Microsoft YaHei",sans-serif`;c.textAlign=align;c.fillStyle=color;c.fillText(value,x,y);}
function sleeve(c,shoulder,elbow,hand){
  c.lineCap='round';c.lineJoin='round';
  line(c,[shoulder,elbow,hand],'#26322c',6.5);line(c,[shoulder,elbow,hand],'#687653',4.8);
  line(c,[[shoulder[0],shoulder[1]-1],[elbow[0],elbow[1]-1],[hand[0]-2,hand[1]-1]],'#849068',1.4);
}
function glove(c,p){
  c.save();c.translate(...p);c.rotate(-.25);c.fillStyle='#26342f';c.beginPath();c.ellipse(0,0,3.6,2.5,0,0,Math.PI*2);c.fill();
  line(c,[[-1.5,-.8],[1.4,-.8]],'#a1a78b',1);c.restore();
}
export function drawUnit(c,a,f,{weapon='mg',x,y,size=36,angle=0,recoil=0,enemy=false,guides=false}){
  const p=weapon==='none'?null:weaponPose(weapon,recoil),scale=size/36;
  c.save();c.translate(x,y);c.scale(scale,scale);
  c.fillStyle='#0c191b28';c.beginPath();c.ellipse(-3,3,21,17,0,0,Math.PI*2);c.fill();c.rotate(angle);
  if(weapon==='flame')part(c,a,f,'tanks',-19,0,20,27);
  const far=p?.far??[6,-12],near=p?.near??[6,12];
  sleeve(c,[-7,-11],[6,-9],far);
  part(c,a,f,'torso',-7,0,31,35);
  sleeve(c,[-7,11],[2,13],near);
  if(p){const box=f[weapon],bore=weapon==='rocket'||weapon==='flame'?750:450;part(c,a,f,weapon,p.left+p.length/2,p.axis+(box[1]+box[3]/2-bore)*p.length/box[2],p.length);}
  glove(c,far);glove(c,near);
  part(c,a,f,'helmet',-2,-1,18,18);
  line(c,[[-9,12],[-5,13]],enemy?'#b97560':'#66a6aa',2.8);
  if(guides&&p){for(const point of [far,near]){c.strokeStyle='#f3c24e';c.lineWidth=.6;c.beginPath();c.arc(...point,4.3,0,Math.PI*2);c.stroke();}}
  c.restore();
  const muzzle=p?.muzzle??[0,0];return {x:x+(muzzle[0]*Math.cos(angle)-muzzle[1]*Math.sin(angle))*scale,y:y+(muzzle[0]*Math.sin(angle)+muzzle[1]*Math.cos(angle))*scale};
}
function background(c,dark){c.fillStyle=dark?'#293e42':'#c5d0b5';c.fillRect(0,0,1200,600);for(let x=0;x<1200;x+=40)line(c,[[x,0],[x,600]],dark?'#e8f5e607':'#173a2409',1);}
export function drawHit(c,a,x,y,age,weapon,material){
  const duration=weapon==='rocket'?.75:weapon==='flame'?.28:.28;
  if(age<0||age>duration)return;
  const t=age/duration,power=weapon==='rocket'?2.2:weapon==='sniper'?1.5:1;
  c.save();c.globalAlpha=1-t;
  if(material==='ground'||weapon==='rocket'){
    c.fillStyle='#5d554b';c.beginPath();c.ellipse(x,y,6*power,3*power,0,0,Math.PI*2);c.fill();
    for(let i=0;i<7;i++){const angle=i*2.4;circle(c,x+Math.cos(angle)*t*12*power,y+Math.sin(angle)*t*8*power,(1.5+t*2.5)*power,'#ada68b48');}
  }
  if(material==='armor')for(let i=0;i<6;i++){
    const angle=Math.PI+(i-2.5)*.28,reach=(4+t*26)*power;
    line(c,[[x+Math.cos(angle)*reach*.45,y+Math.sin(angle)*reach*.45],[x+Math.cos(angle)*reach,y+Math.sin(angle)*reach]],i%2?'#fff1b1':'#eeac52',(1-t)*2+.3);
  }
  if(material==='soldier'){
    circle(c,x,y,3.5*power*(1-t),'#e7d8b1');
    for(let i=0;i<5;i++){const angle=i*2.2;circle(c,x+Math.cos(angle)*t*16,y+Math.sin(angle)*t*10,1.4*(1-t),'#705c4b');}
  }
  if(weapon==='rocket'){
    circle(c,x,y,5+26*t,'#e3a85a55');if(t<.18)circle(c,x,y,8*(1-t),'#fff3be');
    img(c,a.smoke_01,[0,0,a.smoke_01.width,a.smoke_01.height],x+5,y-12*t,30+65*t,30+65*t,(1-t)*.33);
  }else if(weapon==='flame'){
    circle(c,x,y,8,'#e9a75255');for(let i=0;i<3;i++)circle(c,x+Math.sin(i*4+age*4)*6,y-4-t*12-i*3,3*(1-t),'#efa35477');
  }else if(age<.045)circle(c,x,y,3,'#fff2c9');
  c.restore();
}
function target(c,a,f,x,y,material,age,weapon){
  const kick=age>=0&&age<.18?(1-age/.18)*(weapon==='sniper'?4:weapon==='rocket'?6:2):0;
  if(material==='soldier'){
    drawUnit(c,a,f,{weapon:'rifle',x:x+18+kick,y,size:40,angle:Math.PI,enemy:true});
    if(age>=0&&age<.07){c.save();c.globalAlpha=.2;circle(c,x+15+kick,y,12,'#fff1d5');c.restore();}
  }else if(material==='armor'){
    c.fillStyle='#506464';c.fillRect(x,y-20,34,40);c.strokeStyle='#90a6a3';c.lineWidth=2;c.strokeRect(x+2,y-18,30,36);line(c,[[x+4,y],[x+29,y]],'#20383c',2);
  }else {c.fillStyle='#a49d8033';c.beginPath();c.ellipse(x+14,y,35,20,0,0,Math.PI*2);c.fill();}
}
export function drawImpact(c,a,f,s,time){
  const list=visibleWeapons(s.weapon).filter(w=>w!=='none'),rows=list.length?list:['rifle'],step=480/rows.length,fg=s.dark?'#d6e5df':'#30483f';
  label(c,'命中演示 · 子弹抵达后才出现受击',24,34,17,fg,'left');label(c,'微弱枪口闪光 / 受击、火花、烟尘与后坐分开检查',1176,34,13,fg,'right');
  rows.forEach((weapon,i)=>{
    const y=100+i*step,g=gunData[weapon],shotAge=time%g.interval,age=time>=g.flight?(time-g.flight)%g.interval:-1;
    const firing=s.motion==='fire',recoil=firing?Math.max(0,1-shotAge/.12):0;
    label(c,weaponNames[weapons.indexOf(weapon)],50,y+5,17,fg,'left');
    const muzzle=drawUnit(c,a,f,{weapon,x:210,y,size:42,recoil}),tx=weapon==='flame'?385:850,ty=muzzle.y;
    target(c,a,f,tx,ty,s.target,firing?age:-1,weapon);
    if(firing){
      if(shotAge<.045)circle(c,muzzle.x,muzzle.y,2,'#ffe1a0');
      if(weapon==='flame'){
        c.save();c.fillStyle='#e6a35c66';c.beginPath();c.moveTo(muzzle.x,muzzle.y-2);
        for(let j=1;j<=8;j++)c.lineTo(muzzle.x+(tx-muzzle.x)*j/8,muzzle.y-j+Math.sin(j*3+time*18)*2);
        for(let j=8;j>=1;j--)c.lineTo(muzzle.x+(tx-muzzle.x)*j/8,muzzle.y+j+Math.sin(j*4+time*18)*2);
        c.closePath();c.fill();line(c,[[muzzle.x,muzzle.y],[tx-8,muzzle.y]],'#f6d19288',3);c.restore();
      }else{
        // Several fast rounds may be in flight simultaneously; impacts use the same arrival clock.
        for(let shot=Math.floor(time/g.interval);shot>=Math.max(0,Math.floor((time-g.flight)/g.interval));shot--){
          const progress=(time-shot*g.interval)/g.flight;if(progress<0||progress>=1)continue;
          const x=muzzle.x+(tx-muzzle.x)*progress;
          if(weapon==='rocket')img(c,a.smoke_04,[0,0,a.smoke_04.width,a.smoke_04.height],x-16,ty,28,12,.3);
          line(c,[[Math.max(muzzle.x,x-(weapon==='sniper'?25:12)),ty],[x,ty]],weapon==='rocket'?'#d6a36c':'#f4e3b5',weapon==='rocket'?3:1.3);
        }
      }
      drawHit(c,a,tx,ty,age,weapon,s.target);
    }
    label(c,{soldier:'人体 · 短闪 / 轻微后移',armor:'装甲 · 定向金属火花',ground:'地面 · 土屑 / 烟尘'}[s.target],1010,y+5,13,fg);
    if(i<rows.length-1)line(c,[[24,y+step*.5],[1176,y+step*.5]],s.dark?'#9fc1b520':'#32564020',1);
  });
}
export function drawArmy(c,a,f,s,time){
  background(c,s.dark);if(s.inspection==='impact'){drawImpact(c,a,f,s,time);return;}
  const fg=s.dark?'#dce8dc':'#29443c',list=visibleWeapons(s.weapon),cell=1120/list.length;
  label(c,s.inspection==='four'?'四向检查 · 身体、手、武器整体旋转':'持握检查 · 金色圈为双手握点',24,32,17,fg,'left');
  list.forEach((weapon,i)=>{
    const x=80+cell*(i+.5),g=gunData[weapon],recoil=s.motion==='fire'&&g?Math.max(0,1-time%g.interval/.12):0;
    label(c,weaponNames[weapons.indexOf(weapon)],x,74,18,fg);
    if(s.inspection==='four'){
      for(let row=0;row<4;row++)drawUnit(c,a,f,{weapon,x:x-12,y:135+row*125,size:48,angle:row*Math.PI/2,recoil,guides:s.guides});
    }else{
      const angle=s.motion==='rotate'?time*.65:(s.angle??0),dx=s.motion==='move'?Math.sin(time)*16:0;
      drawUnit(c,a,f,{weapon,x:x-20+dx,y:185,size:72,angle,recoil,guides:s.guides});
      label(c,'72px 放大检查',x,270,12,fg);
      for(let j=0;j<6;j++)drawUnit(c,a,f,{weapon,x:x+(j%3-1)*Math.max(20,9*s.scale*1.6),y:390+Math.floor(j/3)*Math.max(24,9*s.scale*1.6),size:9*s.scale,angle,recoil,enemy:j>=3});
    }
  });
  if(s.inspection==='four')['右','下','左','上'].forEach((direction,row)=>label(c,direction,25,140+row*125,16,fg));
  else {line(c,[[24,300],[1176,300]],s.dark?'#77928d':'#8aa080',1);label(c,`小队辨识度 · 身体 ${9*s.scale}px`,24,338,15,fg,'left');}
}
