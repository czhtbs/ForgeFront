import { bodyStyles,uiStyles,mapStyles,particles,particleNames,images,buildingNames,buildings,scenery,sceneryNames } from './catalog.js';
import { W,H,drawArmy,drawMap,drawBuildings,pickBuilding,land } from './render.js';

const $=id=>document.getElementById(id);
const canvas=$('preview'),ctx=canvas.getContext('2d'),strip=$('buildings'),stripCtx=strip.getContext('2d');
const s={module:new URLSearchParams(location.search).get('view')==='map'?'map':'army',indices:{army:0,ui:0,map:0},style:'rigged',variant:0,weapon:'all',motion:'fire',inspection:'pose',target:'soldier',guides:false,scale:2,dark:true,boundaries:true,selected:6,panX:0,panY:0,infantry:true,animate:true,soldierScale:1};
const demo={gold:860,levels:Array(12).fill(2),status:'normal',effect:'pierce'};
const groups={army:bodyStyles,ui:uiStyles,map:mapStyles};
let assets,frames,transform={scale:1,x:0,y:0},toastUntil=0;

async function loadAssets(){
  const entries=await Promise.all(Object.entries(images).map(([key,src])=>new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>resolve([key,img]);img.onerror=()=>reject(new Error(`素材加载失败：${src}`));img.src=src;
  })));
  assets=Object.fromEntries(entries);frames=await fetch('soldier-frames.json').then(r=>r.json());
}
function resize(){
  const {width,height}=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio,2);
  canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  transform={scale:Math.min(width/W,height/H),x:0,y:0};transform.x=(width-W*transform.scale)/2;transform.y=(height-H*transform.scale)/2;
  strip.width=Math.round(strip.clientWidth*dpr);strip.height=150*dpr;
}
function sync(){
  const options=groups[s.module],index=s.indices[s.module];s.style=options[index][0];
  $('candidate').innerHTML=options.map(([id,name],i)=>`<option value="${i}" ${i===index?'selected':''}>${name}</option>`).join('');
  $('previous').disabled=$('next').disabled=options.length===1;
  $('counter').textContent=`${index+1} / ${options.length}`;
  $('description').textContent=options[index][2];
  document.querySelectorAll('[data-module]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.module===s.module)));
  for(const module of ['army','ui','map'])$(module+'-controls').hidden=s.module!==module;
  $('game-ui').hidden=s.module!=='ui';$('building-strip').hidden=s.module!=='map';
  if(s.module==='army'){
    s.scale=Number($('scale').value);
    $('stage-hint').textContent='先检查双手接触与肩部遮挡，再切换四向和命中演示；命中可比较人体、装甲与地面。';
  }else if(s.module==='map'){
    s.scale=Number($('map-scale').value);
    $('stage-hint').textContent='滚轮以鼠标位置缩放，右键拖动地图；点击建筑高亮。可开关步兵、行军交火与边界，比较全图和近景的协调性。';
  }else{
    s.scale=1;s.panX=0;s.panY=0;s.variant=0;$('game-ui').className=`theme-${s.style}`;
    $('stage-hint').textContent='点地图建筑查看详情，点空地收起；可操作升级、工坊产出、菜单和状态切换。数字为演示样例，视觉动画不代表正式对局。';
    renderInspector();
  }
  const pack=s.module==='army'?'新图集＋程序持握；命中烟尘贴图：Kenney / CC0':s.module==='ui'?'B 版原生界面；毒气图标：Lorc / CC BY 3.0':'建筑与地形：拆分自参考图；地图与步兵：程序实时绘制';
  $('credit').textContent=pack;resize();
}
function renderInspector(){
  $('gold').textContent=demo.gold;$('inspector').hidden=s.selected<0;
  if(s.selected<0)return;
  const kind=land[s.selected].type,name=buildingNames[buildings.indexOf(kind)],level=demo.levels[s.selected];
  $('building-icon').src=s.style==='light'?images[kind]:images['scene-'+land[s.selected].variant];$('building-title').textContent=name;$('level').textContent=`等级 ${level}`;
  const upgrade=`<button data-action="upgrade" ${level>=5||demo.gold<level*100?'disabled':''}>${level>=5?'已达最高等级':`升级 · ${level*100} 金`}</button>`;
  if(kind==='barracks'||kind==='hq'){
    const bad=['cut','conflict'].includes(demo.status),full=demo.status==='full';
    const label={normal:'装配中 · 4 秒/人',cut:'供给中断 · 等待输入',conflict:'主武器冲突 · 停止装配',full:'生成满员 · 仍可装配'}[demo.status];
    const effect=demo.effect==='gas'?`<img src="${images.poison}" alt="毒气图标"><strong>毒气</strong>`:'<span class="effect-glyph">➤</span><strong>穿透</strong>';
    $('building-content').innerHTML=`<div class="supply"><div class="supply-item"><span class="effect-glyph">MG</span><strong>机枪</strong><span>0.25 件/秒</span></div><span class="supply-plus">＋</span><div class="supply-item">${demo.status==='conflict'?'<span class="effect-glyph">RPG</span><strong>火箭筒</strong>':effect}<span>${demo.status==='cut'?'0':'0.25'} 件/秒</span></div><span class="supply-plus">→</span><div class="assembly"><strong class="${bad?'status-error':''}">${label}</strong><div class="progress"><i id="assembly-progress"></i></div></div></div><div class="population"><b>${full?60:42} / 60 人</b><p>未装备 18 · 已装备 ${full?30:12}<br>军队 12</p></div><div class="upgrade-action">${upgrade}</div>`;
  }else if(kind==='workshop')$('building-content').innerHTML=`<div class="building-detail"><label>工坊产出<select id="demo-output"><option>机枪</option><option>狙击枪</option><option>火箭筒</option><option>火焰喷射器</option></select></label><p>2 条连接 · 各 0.25 件/秒 · 装备无库存</p></div>${upgrade}`;
  else $('building-content').innerHTML=`<div class="building-detail"><strong>${kind==='mine'?'黄金收入：6 金/秒':'堡垒：1000 / 1000'}</strong><p>这块区域的建筑轮廓与详情样例</p></div>${kind==='mine'?upgrade:''}`;
}
function toast(value){$('ui-toast').hidden=false;$('ui-toast').textContent=value;toastUntil=performance.now()+2400;}
function sourceFigure(key,label,pixel=false){return `<figure class="source-sheet ${pixel?'pixel':''}"><img src="${images[key]}" alt="${label}"><figcaption>${label}</figcaption></figure>`;}
function showSource(){
  let html='',note='原始图集包含场景未用到的姿态、物件和配色，可在这里逐项查看。';
  if(s.module==='army'){
    html=sourceFigure('soldier','修正版：无手臂躯干、头盔、背包与五种武器。前臂和手掌在运行时连接握点。');
    html+='<h3>本地保存的全部粒子样本</h3><div class="source-grid">'+particles.map((p,i)=>`<figure class="source-item"><img src="${images[p]}" alt="${particleNames[i]}"><figcaption>${particleNames[i]} · ${p}</figcaption></figure>`).join('')+'</div>';
  }else if(s.module==='ui'){
    note='下载按钮已删除；当前按钮使用原生界面样式。';
    html=sourceFigure('poison','保留的毒气图标 · Lorc / CC BY 3.0');
  }else if(s.style==='composed')html='<div class="source-grid">'+scenery.map((key,i)=>`<figure class="source-item"><img src="${images['scene-'+key]}" alt="${sceneryNames[i]}"><figcaption>${sceneryNames[i]}</figcaption></figure>`).join('')+'</div>';
  else html='<div class="source-grid">'+buildings.map((key,i)=>`<figure class="source-item"><img src="${images[key]}" alt="${buildingNames[i]}"><figcaption>${buildingNames[i]}</figcaption></figure>`).join('')+'</div>';
  $('source-note').textContent=note;$('source-images').innerHTML=html;$('source-dialog').showModal();
}

document.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>{s.module=b.dataset.module;sync();});
$('candidate').onchange=e=>{s.indices[s.module]=Number(e.target.value);sync();};
for(const [id,direction] of [['previous',-1],['next',1]])$(id).onclick=()=>{const length=groups[s.module].length;s.indices[s.module]=(s.indices[s.module]+direction+length)%length;sync();};
for(const id of ['weapon','motion','inspection','target'])$(id).onchange=e=>{s[id]=e.target.value;};
$('scale').onchange=e=>{s.scale=Number(e.target.value);};
$('dark-ground').onchange=e=>{s.dark=e.target.checked;};$('boundaries').onchange=e=>{s.boundaries=e.target.checked;};
$('map-scale').oninput=e=>{s.scale=Number(e.target.value);$('map-zoom').textContent=Math.round(s.scale*100)+'%';};
$('soldier-size').onchange=e=>{s.soldierScale=Number(e.target.value);};
$('infantry').onchange=e=>{s.infantry=e.target.checked;};
$('animate-map').onchange=e=>{s.animate=e.target.checked;};
$('reset-map').onclick=()=>{s.scale=1;s.panX=0;s.panY=0;$('map-scale').value='1';$('map-zoom').textContent='100%';};
$('guides').onchange=e=>{s.guides=e.target.checked;};
$('status').onchange=e=>{demo.status=e.target.value;renderInspector();};$('effect').onchange=e=>{demo.effect=e.target.value;renderInspector();};
$('select-barracks').onclick=()=>{s.selected=1;renderInspector();};
$('reset-ui').onclick=()=>{demo.gold=860;demo.levels.fill(2);demo.status='normal';$('status').value='normal';s.selected=1;renderInspector();toast('样例已重置');};
$('close-inspector').onclick=()=>{s.selected=-1;renderInspector();};
$('overview').onclick=()=>{s.selected=-1;renderInspector();toast('全图 · 详情已收起');};
$('menu-button').onclick=()=>{$('demo-menu').hidden=false;};$('resume').onclick=()=>{$('demo-menu').hidden=true;};
$('building-content').onclick=e=>{if(e.target.closest('[data-action="upgrade"]')){const level=demo.levels[s.selected];demo.gold-=level*100;demo.levels[s.selected]++;renderInspector();toast('升级完成');}};
$('building-content').onchange=e=>{if(e.target.id==='demo-output')toast(`当前工坊产出：${e.target.value}`);};
canvas.onclick=e=>{
  if(s.module==='army')return;const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left-transform.x)/transform.scale,y=(e.clientY-r.top-transform.y)/transform.scale;
  s.selected=pickBuilding(x,y,s.scale,s.panX,s.panY);if(s.module==='ui')renderInspector();
};
let panDrag=null;
canvas.oncontextmenu=e=>e.preventDefault();
canvas.onpointerdown=e=>{if(s.module!=='army'&&e.button===2){panDrag={x:e.clientX,y:e.clientY,panX:s.panX,panY:s.panY};canvas.setPointerCapture(e.pointerId);}};
canvas.onpointermove=e=>{if(panDrag){s.panX=panDrag.panX+(e.clientX-panDrag.x)/transform.scale;s.panY=panDrag.panY+(e.clientY-panDrag.y)/transform.scale;}};
canvas.onpointerup=()=>{panDrag=null;};canvas.onpointercancel=()=>{panDrag=null;};
canvas.addEventListener('wheel',e=>{
  if(s.module==='army')return;e.preventDefault();
  const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left-transform.x)/transform.scale,y=(e.clientY-r.top-transform.y)/transform.scale;
  const worldX=(x-600-s.panX)/s.scale,worldY=(y-300-s.panY)/s.scale;
  s.scale=Math.max(.75,Math.min(3,s.scale*(e.deltaY>0?.9:1.1)));s.panX=x-600-worldX*s.scale;s.panY=y-300-worldY*s.scale;
  $('map-scale').value=String(s.scale);$('map-zoom').textContent=Math.round(s.scale*100)+'%';
},{passive:false});
$('show-source').onclick=showSource;$('close-source').onclick=()=>$('source-dialog').close();
window.addEventListener('resize',resize);

let previous=0;
function frame(now){
  requestAnimationFrame(frame);if(now-previous<1000/30)return;previous=now;
  const time=now/1000,dpr=Math.min(devicePixelRatio,2);ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#30454a';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr*transform.scale,0,0,dpr*transform.scale,dpr*transform.x,dpr*transform.y);
  if(s.module==='army')drawArmy(ctx,assets,frames,s,time);
  else drawMap(ctx,assets,frames,{...s,style:s.module==='ui'?(s.style==='light'?'current':'composed'):s.style,boundaries:s.module==='ui'?true:s.boundaries},time);
  if(s.module==='map'){stripCtx.setTransform(strip.width/1200,0,0,strip.height/150,0,0);drawBuildings(stripCtx,assets,s);}
  if(s.module==='ui'){
    const progress=$('assembly-progress');if(progress)progress.style.width=(['cut','conflict'].includes(demo.status)?0:time%4/4*100)+'%';
    if(now>toastUntil)$('ui-toast').hidden=true;
  }
}
try{await loadAssets();sync();$('loading').hidden=true;requestAnimationFrame(frame);}catch(error){$('loading').textContent=error.message;throw error;}
