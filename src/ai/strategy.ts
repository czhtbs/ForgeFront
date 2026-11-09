import { canFight, isWorkshop, configuration, WEAPONS, AMMO } from '../content/equipment.ts';
import type { Item, Workshop } from '../content/equipment.ts';
import type { World } from '../sim/types.ts';
import { build, connect, dispatch, retreat, upgrade, configuredItems, setFactoryOutput, supplyConflict, bombard } from '../sim/world.ts';
import { shortestPath, movementPath, distance } from '../sim/map.ts';
export function runAI(w: World, owner: number) {
  const faction = w.factions[owner], land = w.provinces.filter(p => p.owner === owner);
  const front = land.filter(p => p.neighbors.some(n => w.provinces[n].owner !== owner));
  const active = new Set(w.battles.map(b => b.province));
  for (const b of w.battles) {
    const ours = [...b.fighters, ...b.reserve].filter(s => s.owner === owner), enemies = [...b.fighters, ...b.reserve].filter(s => s.owner !== owner);
    if (ours.length && (enemies.length > ours.length * 2 || ours.every(s => s.effects.includes('lob')) && enemies.length)) {
      const dest = w.provinces[b.province].neighbors.find(n => w.provinces[n].owner === owner && !active.has(n));
      if (dest !== undefined) retreat(w, b.province, dest, owner);
    }
  }
  const barracks = land.filter(p => p.building === 'hq' || p.building === 'barracks');
  const factories = land.filter(p => isWorkshop(p.building));
  const empty = land.filter(p => !p.building && !active.has(p.id));
  let built = false;
  for (const [index, home] of barracks.entries()) {
    const input = configuredItems(w, home.id), config = configuration(input), melee = config.weapon === 'hilt' || config.ammo === 'blade' || !config.weapon && !config.ammo && index % 3 === 1;
    const wanted: Item[] = [config.weapon ?? (melee ? 'hilt' : 'launcher'), config.ammo ?? (melee ? 'blade' : 'round'), ...(index % 3 === 2 ? ['lob', 'homing', 'blast'] as Item[] : melee ? ['pierce', 'frost'] as Item[] : ['pierce', 'burn'] as Item[])];
    for (const item of wanted.filter(i => !input.includes(i))) {
      const source = factories.filter(p => p.output === item && !supplyConflict(w, p.id, home.id)).map(p => ({ p, path: shortestPath(w.provinces, p.id, home.id, owner) })).filter(x => x.path.length).sort((a, b) => a.path.length - b.path.length)[0];
      if (source) { connect(w, source.p.id, home.id, owner); continue; }
      if (!built && empty.length && faction.gold >= 110) {
        const location = empty.shift()!, kind: Workshop = item in WEAPONS ? 'launcherWorks' : item in AMMO ? 'ammoWorks' : 'attachmentWorks';
        if (!build(w, location.id, kind, owner)) { setFactoryOutput(w, location.id, item, owner); connect(w, location.id, home.id, owner); built = true; }
      }
      break;
    }
  }
  if (!built && empty.length && faction.gold > 220) build(w, empty[0].id, land.filter(p => p.building === 'mine').length < Math.ceil(land.length / 5) ? 'mine' : 'barracks', owner);
  for (const p of land) {
    if (active.has(p.id)) continue;
    const troops = [...p.troops, ...p.mobile].filter(canFight), guns = troops.filter(s => s.effects.includes('lob'));
    for (const target of w.provinces.filter(q => q.owner !== owner).sort((a, b) => distance(p, a) - distance(p, b))) {
      if (guns.length && !bombard(w, guns.map(s => s.id), target.id, target, owner)) { faction.intent = `炮击 ${target.name}`; break; }
    }
    const ground = troops.filter(s => !s.effects.includes('lob')), count = ground.length;
    const targets = w.provinces.filter(q => { if (q.owner === owner) return false; const path = movementPath(w, p.id, q.id, owner); return path.length > 1 && path.slice(1, -1).every(id => w.provinces[id].owner === owner); }).sort((a, b) => (a.building === 'hq' ? -100 : a.hp) - (b.building === 'hq' ? -100 : b.hp));
    if (targets.length && count > 20) {
      const target = targets.find(t => count > t.troops.filter(canFight).length * 1.15 + 10);
      if (target) { dispatch(w, p.id, target.id, Math.floor(count * .8), owner, undefined, new Set(ground.map(s => s.id))); faction.intent = `进攻 ${target.name}`; }
    } else if (!targets.length && count > 25 && front.length) {
      const dest = [...front].sort((a, b) => a.troops.length - b.troops.length)[0];
      if (dest.id !== p.id) dispatch(w, p.id, dest.id, count - 12, owner, undefined, new Set(ground.map(s => s.id)));
    }
  }
  if (faction.gold > 300) { const p = barracks.find(p => p.level < 3) ?? factories.find(p => p.level < 3); if (p) upgrade(w, p.id, owner); }
}
