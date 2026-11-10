const gunData={
  rifle:{length:44,left:-4,axis:7,trigger:.30,support:.62},
  rocket:{length:49,left:-12,axis:-5,trigger:.46,support:.68},
};
export function weaponPose(weapon,recoil=0){
  const g=gunData[weapon],left=g.left-recoil*1.8;
  return {...g,left,near:[left+g.length*g.trigger,g.axis+2],far:[left+g.length*g.support,g.axis-1],muzzle:[left+g.length,g.axis]};
}
function img(c,image,f,x,y,w,h,alpha=1){c.save();c.globalAlpha=alpha;c.drawImage(image,...f,x-w/2,y-h/2,w,h);c.restore();}
function part(c,a,f,key,x,y,w,h){const box=f[key];img(c,a.soldier,box,x,y,w,h??w*box[3]/box[2]);}
function line(c,points,color,width){c.strokeStyle=color;c.lineWidth=width;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
function sleeve(c,shoulder,elbow,hand){
  c.lineCap='round';c.lineJoin='round';
  line(c,[shoulder,elbow,hand],'#26322c',6.5);line(c,[shoulder,elbow,hand],'#687653',4.8);
  line(c,[[shoulder[0],shoulder[1]-1],[elbow[0],elbow[1]-1],[hand[0]-2,hand[1]-1]],'#849068',1.4);
}
function glove(c,p){
  c.save();c.translate(...p);c.rotate(-.25);c.fillStyle='#26342f';c.beginPath();c.ellipse(0,0,3.6,2.5,0,0,Math.PI*2);c.fill();
  line(c,[[-1.5,-.8],[1.4,-.8]],'#a1a78b',1);c.restore();
}
export function drawUnit(c,a,f,{weapon='rifle',x,y,size=36,angle=0,recoil=0,enemy=false,guides=false}){
  const p=weapon==='none'?null:weaponPose(weapon,recoil),scale=size/36;
  c.save();c.translate(x,y);c.scale(scale,scale);
  c.fillStyle='#0c191b28';c.beginPath();c.ellipse(-3,3,21,17,0,0,Math.PI*2);c.fill();c.rotate(angle);
  const far=p?.far??[6,-12],near=p?.near??[6,12];
  sleeve(c,[-7,-11],[6,-9],far);
  part(c,a,f,'torso',-7,0,31,35);
  sleeve(c,[-7,11],[2,13],near);
  if(p){const box=f[weapon],bore=weapon==='rocket'?750:450;part(c,a,f,weapon,p.left+p.length/2,p.axis+(box[1]+box[3]/2-bore)*p.length/box[2],p.length);}
  glove(c,far);glove(c,near);
  part(c,a,f,'helmet',-2,-1,18,18);
  line(c,[[-9,12],[-5,13]],enemy?'#b97560':'#66a6aa',2.8);
  if(guides&&p){for(const point of [far,near]){c.strokeStyle='#f3c24e';c.lineWidth=.6;c.beginPath();c.arc(...point,4.3,0,Math.PI*2);c.stroke();}}
  c.restore();
  const muzzle=p?.muzzle??[0,0];return {x:x+(muzzle[0]*Math.cos(angle)-muzzle[1]*Math.sin(angle))*scale,y:y+(muzzle[0]*Math.sin(angle)+muzzle[1]*Math.cos(angle))*scale};
}
