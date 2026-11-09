import test from 'node:test';
import assert from 'node:assert/strict';
import { createMap, inside, shortestPath } from '../src/sim/map.ts';
import { createWorld, stepWorld, dispatch, build, connect, totalTroops, endMatch, soldier, trainingBattle, retreat, reroute, disconnect, productionState, routeRate, localTroops, travelTime, redirect, orderUnits, allTroops, setFactoryOutput } from '../src/sim/world.ts';
import { configuration, validateLoadout, canFight, equipmentKey, unitKey, WEAPONS } from '../src/content/equipment.ts';
import { fireAttack, stepAttacks, resolveDeaths } from '../src/sim/attacks.ts';
import { fortPosition } from '../src/sim/spatial.ts';
import { addBattle, reinforce, segmentDistance, stepBattle, DEPLOY_TICKS } from '../src/sim/combat.ts';
import { BATTLE_CAP, FORT } from '../src/sim/types.ts';
import { routeGeometry, editedWaypoints } from '../src/render/geometry.ts';
import { MOVE_SPEED, battleFrame, formation, troopSize, assignSlots, toWorld, toBattle, SOLDIER_SIZE } from '../src/sim/spatial.ts';
import { toggleUnits, orderGesture } from '../src/ui/interaction.ts';
import { movementPath } from '../src/sim/map.ts';
const settings = { seed: 4521, count: 12, enemies: 1, difficulty: 'normal' as const };
const advance = (w, seconds) => { for (let i = 0; i < seconds * 30; i++) stepWorld(w); };
const finishMarch = w => { for (let i=0;i<180*30 && w.shipments.length;i++) stepWorld(w); assert.equal(w.shipments.length,0); };
const quiet = () => { const w = createWorld(settings); w.factions.forEach(f => f.ai = false); return w; };
test('seeded irregular cells form a connected map with valid symmetric adjacency', () => {
  for (const count of [10, 12, 40, 60, 80]) {
    const a = createMap(count, 4521); assert.deepEqual(a, createMap(count, 4521));
    assert.equal(a.length, count); const seen = new Set([0]), queue = [0];
    for (const id of queue) for (const n of a[id].neighbors) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    assert.equal(seen.size, count);
    for (const p of a) { assert.ok(inside(p, p.polygon)); assert.ok(p.polygon.length >= 3); for (const n of p.neighbors) assert.ok(a[n].neighbors.includes(p.id)); }
  }
});
test('starting HQ/mine pairs, automatic generation and fixed garrison capacity', () => {
  const w = quiet(); for (const f of w.factions) { const hq = w.provinces[f.hq]; assert.ok(hq.neighbors.some(n => w.provinces[n].owner === f.id && w.provinces[n].building === 'mine')); }
  advance(w, 90); for (const f of w.factions) assert.equal(w.provinces[f.hq].troops.length, 60);
  assert.ok(w.factions.every(f => f.gold >= 0));
});


test('a captured endpoint destroys its connections and redistributes remaining factory capacity', () => {
  const w = quiet(); w.provinces.forEach(p => { p.owner = 0; p.building = null; });
  const source = w.provinces[0]; source.building = 'launcherWorks'; source.level = 4;
  for (const id of [1, 2, 3]) { w.provinces[id].building = 'barracks'; connect(w, 0, id); }
  assert.equal(routeRate(w, 0), 1 / 3); assert.ok(connect(w, 0, 1));
  advance(w, 1); const flow = { ...w.flows.find(f => f.to === 1)! };
  w.provinces[1].owner = 1; advance(w, 1);
  assert.ok(w.routes.every(r => r.to !== 1)); assert.equal(routeRate(w, 0), .5);
  assert.ok(w.flows.some(f => f.to === 1 && f.end === flow.end));
  disconnect(w, w.routes[0].id); assert.equal(routeRate(w, 0), 1);
  advance(w, 40); assert.ok(w.flows.every(f => f.to !== 1)); assert.equal('stock' in source, false);
});
test('remote attacks can pass neutral territory without capturing the intermediate province', () => {
  const w = quiet(), hq = w.provinces[w.factions[0].hq];
  const target = w.provinces.find(p => p.owner === -1 && !hq.neighbors.includes(p.id) && movementPath(w, hq.id, p.id, 0).length)!;
  const path = movementPath(w, hq.id, target.id, 0); assert.ok(path.length > 2); const owners = path.slice(1, -1).map(id => w.provinces[id].owner);
  assert.equal(dispatch(w, hq.id, target.id, 30), null);
  for (let i=0;i<(travelTime(w,path)+5)*30 && !w.battles.some(b=>b.province===target.id);i++) stepWorld(w); assert.deepEqual(path.slice(1, -1).map(id => w.provinces[id].owner), owners);
  assert.equal(w.battles.filter(b => b.province === target.id).length, 1);
  advance(w, 80); assert.equal(target.owner, 0); assert.ok(target.troops.length);
});
test('active entity limits preserve excess soldiers after deployment', () => {
  const w = quiet(), p = w.provinces[0]; p.troops = []; p.mobile = [];
  const b = addBattle(w, p.id, Array.from({ length: 500 }, (_, i) => soldier(w, i % 2, 'launcher')));
  for (const unit of b.reserve) unit.deployAt = 0;
  for (let i = 0; i < 10; i++) reinforce(w, b);
  assert.equal(b.fighters.length, BATTLE_CAP); assert.equal(b.fighters.length + b.reserve.length, 500);
});



test('identical commands reproduce simulation and AI decisions; all soldier IDs are unique', () => {
  const a = createWorld(settings), b = createWorld(settings); advance(a, 35); advance(b, 35); assert.deepEqual(a, b);
  const units = [...a.provinces.flatMap(p => [...p.troops, ...p.mobile]), ...a.shipments.flatMap(s => s.troops), ...a.battles.flatMap(b => [...b.fighters, ...b.reserve])];
  assert.equal(units.length, new Set(units.map(s => s.id)).size); assert.equal(units.length, a.factions.reduce((n, f) => n + totalTroops(a, f.id), 0));
});
test('training battle uses real combat with requested composition', () => {
  const w = createWorld({ ...settings, count: 10, training: true });
  trainingBattle(w, { weapon: 'launcher', ammo: 'round', effects: ['blast'] }, 40);
  advance(w, 8); const b = w.battles[0]; assert.ok(b); assert.equal(b.fighters.length + b.reserve.length + b.losses.reduce((a, b) => a + b, 0), 80); assert.ok(b.fighters.some(s => s.weapon === 'launcher'));
});
test('retreat conserves survivors and moves them back through transit', () => {
  const w = quiet(), home = w.provinces[w.factions[0].hq], target = home.neighbors.find(n => w.provinces[n].owner === -1)!;
  const troops = home.troops.splice(0, 20); const b = addBattle(w, target, troops); reinforce(w, b);
  const before = totalTroops(w, 0); assert.equal(retreat(w, target, home.id), null);
  assert.equal(totalTroops(w, 0), before); assert.equal(b.fighters.filter(s => s.owner === 0).length, 0);
  advance(w, travelTime(w, [target, home.id]) + 1); assert.ok(home.troops.length >= 40); assert.equal(w.shipments.filter(s => s.troops.length).length, 0);
});
test('capturing with more than 60 survivors retains overflow as mobile troops', () => {
  const w = quiet(), target = w.provinces.find(p => p.owner === -1)!;
  const b = addBattle(w, target.id, Array.from({ length: 100 }, () => soldier(w, 0))); reinforce(w, b);
  target.hp = .01; fortShot(w, b, 0); stepWorld(w);
  assert.equal(target.owner, 0); assert.equal(target.troops.length, 60); assert.equal(target.mobile.length, 40);
});
test('a destroyed HQ ends the match and preserves a report without counting cleanup as kills', () => {
  const w = quiet(), hq = w.provinces[w.factions[1].hq]; hq.troops = []; hq.hp = .01;
  const b = addBattle(w, hq.id, Array.from({ length: 10 }, () => soldier(w, 0))); reinforce(w, b); fortShot(w, b, 0);
  stepWorld(w); assert.equal(w.winner, 0); assert.equal(w.factions[1].alive, false); assert.ok(w.result); assert.equal(w.stats[0].kills, 0);
  const tick = w.tick; stepWorld(w); assert.equal(w.tick, tick);
});
test('lost required waypoint falls back to a valid shortest friendly route', () => {
  const w = quiet(); w.provinces.forEach(p => p.owner = 0);
  const from = w.provinces[0], to = w.provinces[from.neighbors[0]], via = w.provinces.find(p => p.id !== from.id && p.id !== to.id)!;
  from.building = 'launcherWorks'; to.building = 'barracks'; connect(w, from.id, to.id);
  const r = w.routes[0]; assert.equal(reroute(w, r.id, [{ x: via.x, y: via.y, province: via.id }]), null); assert.ok(r.path.includes(via.id));
  via.owner = 1; stepWorld(w); assert.deepEqual(r.via, []); assert.deepEqual(r.path, [from.id, to.id]);
});

function fortShot(w, b, owner) {
  const p = w.provinces[b.province], f = b.fighters.find(s => s.owner === owner)!;
  f.x = FORT.x - 20; f.y = FORT.y; f.position = toWorld(p, f);
  fireAttack(w, f, f.position, fortPosition(p), p.id, -p.id - 1);
}



test('unarmed recruits stay out of combat and armed guards take priority over a fort', () => {
  const w = quiet(), p = w.provinces.find(p => p.owner === -1)!; p.owner = 1; p.building = 'barracks';
  p.troops = [{ ...soldier(w, 1), recruit: true, weapon: null, ammo: null }];
  const b = addBattle(w, p.id, [soldier(w, 0)]); reinforce(w, b);
  assert.equal(b.fighters.length, 1); assert.equal(p.troops.length, 1);
  const f = b.fighters[0]; f.x = FORT.x - 160; f.y = FORT.y; f.target = -1; f.targetOwner = 1;
  b.reserve.push(soldier(w, 1)); reinforce(w, b); stepBattle(w, b); stepAttacks(w); resolveDeaths(w); assert.equal(f.target, b.fighters.find(s => s.owner === 1)!.id);
});
test('fort capture changes ownership while surviving enemy guards remain enemies', () => {
  const w = quiet(), p = w.provinces.find(p => p.owner === -1)!; p.owner = 1;
  p.troops = [soldier(w, 1)]; const b = addBattle(w, p.id, [soldier(w, 0)]); reinforce(w, b);
  p.hp = 1; fortShot(w, b, 0); stepWorld(w);
  assert.equal(p.owner, 0); assert.equal(p.hp, 1000); assert.ok(w.battles.includes(b)); assert.ok(b.fighters.some(f => f.owner === 1)); assert.equal(b.models,false);
});
test('movement reroutes around hostile land and stops if every route is blocked', () => {
  const w = quiet(); w.provinces.forEach((p, i) => { p.neighbors = []; p.owner = -1; p.building = null; p.troops = []; });
  const link = (a,b) => { w.provinces[a].neighbors.push(b); w.provinces[b].neighbors.push(a); };
  link(0,1); link(1,3); link(0,2); link(2,3);
  w.provinces[0].owner = 0; w.provinces[1].owner = 1; w.provinces[3].owner = 1;
  w.provinces[0].troops = [soldier(w, 0)]; assert.deepEqual(movementPath(w, 0, 3, 0), [0,2,3]);
  dispatch(w, 0, 3); w.provinces[2].owner = 1; finishMarch(w);
  assert.equal(w.shipments.length, 0); assert.equal(w.provinces[0].troops.length, 1); assert.equal(w.battles.length, 0);
});
test('route points can be inserted, moved, deleted and keep unrelated points in order', () => {
  const a = { x: 1, y: 2, province: 0 }, b = { x: 4, y: 5, province: 1 }, c = { x: 7, y: 8, province: 2 };
  const added = editedWaypoints([a,c], b, 1, false); assert.deepEqual(added, [a,b,c]); assert.deepEqual(editedWaypoints(added, { ...b, x: 6 }, 1, true), [a,{...b,x:6},c]);
  const w = quiet(); w.provinces.forEach(p => p.owner = 0); const from = w.provinces[0], to = w.provinces[from.neighbors[0]]; from.building = 'launcherWorks'; to.building = 'barracks'; connect(w, from.id, to.id);
  const point = { province: from.id, x: from.x + 1, y: from.y + 1 }; reroute(w, w.routes[0].id, [point]);
  assert.ok(routeGeometry(w, w.routes[0]).some(p => p.point.x === point.x && p.point.y === point.y));
  reroute(w, w.routes[0].id, []); assert.equal(w.routes[0].via.length, 0);
});

test('a ranged soldier keeps a fort under attack between shots', () => {
  const w = quiet(), p = w.provinces.find(p => p.owner === -1)!;
  const b = addBattle(w, p.id, [soldier(w, 0, 'launcher')]); reinforce(w, b);
  b.fighters[0].x = FORT.x - 230; b.fighters[0].y = FORT.y;
  advance(w, 15); assert.ok(p.hp < 850); assert.equal(p.owner, -1);
});

test('marches and battlefield locomotion share one world-space speed', () => {
  const w = quiet(), hq = w.provinces[w.factions[0].hq], dest = hq.neighbors[0];
  dispatch(w, hq.id, dest, 1); const moving = w.shipments[0], start = { x: moving.x, y: moving.y };
  advance(w, 1); assert.ok(Math.abs(Math.hypot(moving.x-start.x,moving.y-start.y)-MOVE_SPEED) < 1e-6);
  const target = w.provinces.find(p => p.owner === -1)!, b = addBattle(w, target.id, [soldier(w,0)]); reinforce(w,b);
  const f=b.fighters[0]; f.x=FORT.x-1000; f.y=FORT.y; const x=f.x;
  for(let i=0;i<30;i++) stepBattle(w,b);stepAttacks(w);resolveDeaths(w);
  assert.ok(Math.abs((f.x-x)*battleFrame(target).scale-MOVE_SPEED) < 1e-6);
  assert.ok(travelTime(w,[hq.id,dest]) > 5);
});
test('repeated marching orders turn immediately toward a neighboring province or back home', () => {
  const w = quiet(); w.provinces.forEach(p => { p.owner = 0; p.building = null; });
  const home = w.provinces[w.factions[0].hq], [first, other] = home.neighbors;
  dispatch(w, home.id, first, 1); advance(w, 1);
  const march = w.shipments[0], ids = march.troops.map(s => s.id), count = totalTroops(w, 0);
  for (const target of [first, home.id, other, first, home.id]) {
    assert.ok(inside(march, home.polygon));
    const position = { x: march.x, y: march.y }, goal = w.provinces[target];
    assert.equal(orderUnits(w, ids, target), null);
    assert.deepEqual({ x: march.x, y: march.y }, position);
    const gap = Math.hypot(goal.x - position.x, goal.y - position.y);
    stepWorld(w);
    assert.ok(Math.abs(march.x - position.x - (goal.x - position.x) / gap * MOVE_SPEED / 30) < 1e-6);
    assert.ok(Math.abs(march.y - position.y - (goal.y - position.y) / gap * MOVE_SPEED / 30) < 1e-6);
  }
  finishMarch(w);
  assert.ok(localTroops(w, home.id, 0).some(s => s.id === ids[0]));
  assert.equal(totalTroops(w, 0), count);
});
test('marching groups can split and change destination without teleporting or duplicating soldiers', () => {
  const w=quiet(); w.provinces.forEach(p=>{p.owner=0;p.building=null;});
  const hq=w.provinces[w.factions[0].hq], first=hq.neighbors[0], other=hq.neighbors[1];
  dispatch(w,hq.id,first,4); advance(w,2);
  const march=w.shipments[0], position={x:march.x,y:march.y}, ids=march.troops.map(s=>s.id), before=totalTroops(w,0);
  assert.equal(redirect(w,march.id,other,new Set(ids.slice(0,2))),null);
  assert.equal(w.shipments.length,2);
  for(const s of w.shipments) assert.deepEqual({x:s.x,y:s.y},position);
  const redirected = w.shipments.find(s => s.to === other)!;
  assert.equal(redirected.path[redirected.leg + 1], other);
  assert.equal(totalTroops(w,0),before); assert.equal(new Set(w.shipments.flatMap(s=>s.troops.map(t=>t.id))).size,4);
  advance(w,1); for(const s of w.shipments) assert.ok(Math.hypot(s.x-position.x,s.y-position.y)<=MOVE_SPEED+1e-6);
  advance(w,100); assert.equal(w.shipments.length,0);
  assert.ok(localTroops(w,other,0).some(s=>s.id===ids[0])); assert.ok(localTroops(w,first,0).some(s=>s.id===ids[3]));
});
test('one order controls selected soldiers from multiple provinces and an existing march only', () => {
  const w=quiet(); w.provinces.forEach(p=>{p.owner=0;p.building=null;p.troops=[];});
  w.provinces[0].troops=[soldier(w,0),soldier(w,0)]; w.provinces[1].troops=[soldier(w,0)]; w.provinces[2].troops=[soldier(w,0)];
  const ids=[w.provinces[0].troops[0].id,w.provinces[1].troops[0].id,w.provinces[2].troops[0].id];
  dispatch(w,2,4);advance(w,1);
  assert.equal(orderUnits(w,ids,3),null);assert.equal(w.shipments.length,3);assert.ok(w.shipments.every(s=>s.to===3));
  assert.equal(w.provinces[0].troops.length,1);assert.equal(allTroops(w).length,4);
});
test('enemy targets remain locked, new closer enemies do not cause switching, and forts follow enemies', () => {
  const w=quiet(), p=w.provinces.find(p=>p.owner===-1)!;p.owner=1;
  const b=addBattle(w,p.id,[soldier(w,0),soldier(w,1)]);reinforce(w,b);
  const f=b.fighters.find(s=>s.owner===0)!, enemy=b.fighters.find(s=>s.owner===1)!;
  f.x=50; f.y=50;enemy.x=800;enemy.y=500;f.cooldown=100;enemy.cooldown=100;
  stepBattle(w,b);stepAttacks(w);resolveDeaths(w);assert.equal(f.target,enemy.id);
  b.reserve.push(soldier(w,1));reinforce(w,b);const closer=b.fighters.at(-1)!;closer.x=f.x+50;closer.y=f.y;closer.cooldown=100;
  stepBattle(w,b);stepAttacks(w);resolveDeaths(w);assert.equal(f.target,enemy.id);
  enemy.hp=0;stepBattle(w,b);stepAttacks(w);resolveDeaths(w);assert.equal(f.target,closer.id);
  closer.hp=0;stepBattle(w,b);stepAttacks(w);resolveDeaths(w);assert.equal(f.target,-1);
});
test('Ctrl toggles whole army groups and short clicks do not activate orders', () => {
  let selected=toggleUnits(new Set(),[1,2],false);selected=toggleUnits(selected,[3,4],true);
  assert.deepEqual([...selected],[1,2,3,4]);selected=toggleUnits(selected,[1,2],true);assert.deepEqual([...selected],[3,4]);
  selected=toggleUnits(selected,[3,4],true);assert.equal(selected.size,0);
  assert.equal(orderGesture(2,120),false);assert.equal(orderGesture(0,280),true);assert.equal(orderGesture(7,50),true);
});
test('fixed queues keep every existing slot when soldiers are added or removed', () => {
  for(const count of [12,48]) for(const p of createMap(count,4521)) {
    const first=formation(p,40), full=formation(p,60);
    assert.deepEqual(first,full.slice(0,40));assert.ok(full.every(point=>inside(point,p.polygon)));
    assert.equal(troopSize(p),SOLDIER_SIZE);
  }
  const w=quiet(),p=w.provinces[w.factions[0].hq], before=p.troops.map(s=>({id:s.id,slot:s.slot,position:{...s.position}}));
  const removed=p.troops.splice(5,1)[0];p.troops.push(soldier(w,0));assignSlots(p,p.troops);
  for(const unit of p.troops.filter(s=>before.some(old=>old.id===s.id))) {
    const old=before.find(s=>s.id===unit.id)!;assert.equal(unit.slot,old.slot);assert.deepEqual(unit.position,old.position);
  }
  assert.equal(p.troops.at(-1)!.slot,removed.slot);
});

test('new recruits walk from the barracks while existing queue positions remain unchanged', () => {
  const w=quiet(),p=w.provinces[w.factions[0].hq], originals=p.troops.map(s=>({id:s.id,position:{...s.position}}));
  advance(w,3); const recruit=p.troops.find(s=>s.recruit)!;assert.ok(recruit.position);
  const start={...recruit.position};stepWorld(w);
  assert.ok(Math.hypot(recruit.position!.x-start.x,recruit.position!.y-start.y)<=MOVE_SPEED/30+1e-6);
  assert.notDeepEqual(recruit.position,start);
  for(const old of originals) assert.deepEqual(p.troops.find(s=>s.id===old.id)!.position,old.position);
});

test('marches expand into a staged battle at the entry and preserve deployed positions on retreat', () => {
  const w=quiet(),home=w.provinces[w.factions[0].hq], target=home.neighbors.find(id=>w.provinces[id].owner===-1)!;
  const chosen=home.troops.slice(0,12), ids=new Set(chosen.map(s=>s.id)), positions=new Map(chosen.map(s=>[s.id,{...s.position}]));
  dispatch(w,home.id,target,12,0,undefined,ids);
  for(const unit of w.shipments[0].troops) assert.deepEqual(unit.position,positions.get(unit.id));
  let entered=false;
  for(let i=0;i<120*30&&!entered;i++) {
    const old=new Map(allTroops(w).filter(s=>ids.has(s.id)).map(s=>[s.id,{...s.position}]));stepWorld(w);
    entered=w.battles.some(b=>b.province===target);
    for(const unit of allTroops(w).filter(s=>ids.has(s.id))) {
      if (entered) { assert.ok(inside(unit.position!,w.provinces[target].polygon)); continue; }
      const previous=old.get(unit.id)!;assert.ok(Math.hypot(unit.position!.x-previous.x,unit.position!.y-previous.y)<SOLDIER_SIZE,`teleport: ${unit.id}`);
    }
    entered=w.battles.some(b=>b.province===target);
  }
  assert.ok(entered);const b=w.battles.find(b=>b.province===target)!;
  assert.equal(b.fighters.filter(s=>ids.has(s.id)).length,1);
  assert.equal(b.reserve.filter(s=>ids.has(s.id)).length,11);
  const prior=new Map([...b.fighters,...b.reserve].filter(s=>ids.has(s.id)).map(s=>[s.id,{...s.position}]));
  assert.equal(retreat(w,target,home.id,0,undefined,ids),null);
  for(const s of w.shipments[0].troops) assert.deepEqual(s.position,prior.get(s.id));
});

test('two armies entering neutral territory fight each other before targeting its fort', () => {
  const w=quiet(),p=w.provinces.find(p=>p.owner===-1)!;
  const a=soldier(w,0),b=soldier(w,1);
  a.position=toWorld(p,{x:300,y:100});b.position=toWorld(p,{x:600,y:100});
  const battle=addBattle(w,p.id,[a]);addBattle(w,p.id,[b]);stepWorld(w);
  const first=battle.fighters.find(f=>f.id===a.id)!,second=battle.fighters.find(f=>f.id===b.id)!;
  assert.equal(first.target,b.id);assert.equal(second.target,a.id);assert.equal(p.hp,1000);assert.equal(p.owner,-1);
});

test('later opponents receive active slots without teleporting either side or bypassing combat', () => {
  const w=quiet(),p=w.provinces.find(p=>p.owner===-1)!;
  const battle=addBattle(w,p.id,Array.from({length:300},()=>soldier(w,0)));battle.reserve.forEach(s=>s.deployAt=0);reinforce(w,battle);
  const before=new Map([...battle.fighters,...battle.reserve].map(s=>[s.id,{...s.position}]));
  const enemy=soldier(w,1);enemy.position=toWorld(p,{x:800,y:300});addBattle(w,p.id,[enemy]);reinforce(w,battle);
  assert.ok(battle.fighters.some(s=>s.owner===1));assert.ok(battle.fighters.length<=240);
  assert.equal(battle.fighters.length+battle.reserve.length,301);
  for(const s of [...battle.fighters,...battle.reserve].filter(s=>s.owner===0)) assert.deepEqual(s.position,before.get(s.id));
});


test('opposing marches crossing a neutral border on the same tick join one battle before any fort order', () => {
  const w=quiet(),p=w.provinces.find(p=>p.owner===-1&&p.neighbors.length>=2)!;
  for(const [owner,from] of p.neighbors.slice(0,2).entries()) {
    const origin=w.provinces[from];origin.owner=owner;origin.building=null;origin.troops=[soldier(w,owner)];origin.mobile=[];
    assert.equal(dispatch(w,from,p.id,1,owner),null);
    const march=w.shipments.at(-1)!,edge=p.polygon.filter(v=>origin.polygon.some(q=>Math.hypot(v.x-q.x,v.y-q.y)<.01));
    const midpoint={x:(edge[0].x+edge[1].x)/2,y:(edge[0].y+edge[1].y)/2},length=Math.hypot(p.x-midpoint.x,p.y-midpoint.y);
    march.x=midpoint.x-(p.x-midpoint.x)/length*.1;march.y=midpoint.y-(p.y-midpoint.y)/length*.1;
    march.troops[0].position={x:march.x,y:march.y};
  }
  stepWorld(w);assert.equal(w.shipments.length,0);
  const battle=w.battles.find(b=>b.province===p.id)!;assert.equal(battle.fighters.length,2);
  assert.ok(battle.fighters.every(f=>f.target===battle.fighters.find(other=>other.owner!==f.owner)!.id));
  assert.equal(p.owner,-1);assert.equal(p.hp,1000);
});


test('combat uses the same weapon distances in large and small provinces', () => {
  const make = count => {
    const w=createWorld({...settings,count});w.factions.forEach(f=>f.ai=false);
    const p=w.provinces.find(p=>p.owner===-1)!,attacker=soldier(w,0,'launcher'),defender=soldier(w,1,'launcher');
    attacker.position={x:p.x-14,y:p.y};defender.position={x:p.x+14,y:p.y};attacker.angle=0;defender.angle=Math.PI;
    w.rng=123;const b=addBattle(w,p.id,[attacker,defender]);
    for(let i=0;i<60;i++) stepBattle(w,b);stepAttacks(w);resolveDeaths(w);
    return {health:b.fighters.map(f=>f.hp),shots:b.shots,losses:b.losses};
  };
  assert.deepEqual(make(12),make(48));
});


test('each faction deploys one soldier every 0.2 seconds and reserves do not fire', () => {
  const w=quiet(),p=w.provinces.find(p=>p.owner===-1)!,troops=Array.from({length:8},()=>soldier(w,0));
  const b=addBattle(w,p.id,troops,{x:p.x,y:p.y});reinforce(w,b);
  assert.equal(b.fighters.length,1);assert.equal(b.reserve.length,7);
  for(let tick=1;tick<DEPLOY_TICKS;tick++){w.tick=tick;reinforce(w,b);assert.equal(b.fighters.length,1);}
  w.tick=DEPLOY_TICKS;reinforce(w,b);assert.equal(b.fighters.length,2);
  assert.equal(new Set([...b.fighters,...b.reserve].map(s=>s.id)).size,8);
  assert.ok([...b.fighters,...b.reserve].every(s=>inside(s.position!,p.polygon)));
  const enemy=soldier(w,1);addBattle(w,p.id,[enemy]);enemy.deployAt=w.tick+60;
  b.fighters.forEach(f=>{f.cooldown=0;f.x=FORT.x-100;f.y=FORT.y;});
  const before=b.shots;stepBattle(w,b);stepAttacks(w);resolveDeaths(w);assert.equal(b.shots,before);assert.equal(p.hp,1000);
});






test('a ranged soldier fires from its entry while a melee defender must close the distance', () => {
  const w = quiet(), p = w.provinces.find(p => p.owner === -1)!; p.owner = 1;
  const guard = soldier(w, 1, 'hilt'); guard.position = { x: p.x + 5, y: p.y }; guard.angle = Math.PI; p.troops = [guard];
  const b = addBattle(w, p.id, [soldier(w, 0)], { x: p.x - 25, y: p.y }); reinforce(w, b);
  const ranged = b.fighters.find(f => f.owner === 0)!, melee = b.fighters.find(f => f.owner === 1)!;
  const start = { ...ranged.position }; ranged.cooldown = melee.cooldown = 0; ranged.angle = 0;
  stepBattle(w, b); stepAttacks(w); resolveDeaths(w);
  assert.equal(ranged.advanceTo, undefined); assert.ok(ranged.recoil > 0); assert.equal(melee.recoil, 0);
  assert.deepEqual(ranged.position, start);
});
