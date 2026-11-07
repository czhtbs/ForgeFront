import { canFight } from '../content/equipment.ts';
import type { World } from '../sim/types.ts';
import { build, connect, dispatch, retreat, upgrade, configuredItems, setFactoryOutput } from '../sim/world.ts';
import { shortestPath, movementPath } from '../sim/map.ts';
export function runAI(w: World, owner: number) {
  const faction = w.factions[owner], land = w.provinces.filter(p => p.owner === owner);
  const front = land.filter(p => p.neighbors.some(n => w.provinces[n].owner !== owner));
  const active = new Set(w.battles.map(b => b.province));
  for (const b of w.battles) {
    const ours = b.fighters.filter(s => s.owner === owner).length + b.reserve.filter(s => s.owner === owner).length;
    const enemies = b.fighters.length + b.reserve.length - ours;
    if (ours > 0 && enemies > ours * 2.5) { const dest = w.provinces[b.province].neighbors.find(n => w.provinces[n].owner === owner && !active.has(n)); if (dest !== undefined) retreat(w, b.province, dest, owner); }
  }
  const barracks = land.filter(p => p.building === 'hq' || p.building === 'barracks');
  const factories = land.filter(p => p.building === 'workshop');
  const empty = land.filter(p => !p.building && !active.has(p.id));
  if (empty.length && faction.gold > 180) {
    const location = empty.find(p => front.includes(p)) ?? empty[0];
    build(w, location.id, factories.length < Math.ceil(barracks.length / 2) ? 'workshop' : land.filter(p => p.building === 'mine').length < Math.ceil(land.length / 5) ? 'mine' : 'barracks', owner);
    if (location.building === 'workshop') setFactoryOutput(w, location.id, ['mg', 'sniper', 'rocket', 'flame'][factories.length % 4] as 'mg', owner);
  }
  for (const barracks of land.filter(p => ['hq', 'barracks'].includes(p.building ?? '') && !configuredItems(w, p.id).length)) {
    const source = factories.map(p => ({ p, path: shortestPath(w.provinces, p.id, barracks.id, owner) })).filter(x => x.path.length).sort((a, b) => a.path.length - b.path.length)[0];
    if (source) connect(w, source.p.id, barracks.id, owner);
  }
  for (const factory of factories) {
    const targets = barracks.map(p => ({ p, path: shortestPath(w.provinces, factory.id, p.id, owner) })).filter(t => t.path.length && !configuredItems(w, t.p.id).some(i => ['mg', 'sniper', 'rocket', 'flame'].includes(i) && i !== factory.output)).sort((a, b) => a.path.length - b.path.length);
    if (targets.length && !w.routes.some(r => r.from === factory.id && r.status !== 'cut')) connect(w, factory.id, targets[0].p.id, owner);
  }
  for (const p of land) {
    if (active.has(p.id)) continue;
    const count = [...p.troops, ...p.mobile].filter(canFight).length;
    const targets = w.provinces.filter(q => { if (q.owner === owner) return false; const path = movementPath(w, p.id, q.id, owner); return path.length > 1 && path.slice(1, -1).every(id => w.provinces[id].owner === owner); }).sort((a, b) => {
      const score = (q: typeof a) => q.building === 'hq' ? -80 : q.building === 'workshop' ? -45 : q.building === 'mine' ? -30 : q.owner === -1 ? -20 : q.troops.filter(canFight).length;
      return score(a) - score(b);
    });
    if (targets.length && count > 28) {
      const target = targets.find(t => count > t.troops.filter(canFight).length * 1.15 + 15);
      if (target) { dispatch(w, p.id, target.id, Math.floor(count * .75), owner); faction.intent = `进攻 ${target.name}`; }
    } else if (!targets.length && count > 25 && front.length) {
      const dest = [...front].sort((a, b) => a.troops.length - b.troops.length)[0];
      dispatch(w, p.id, dest.id, count - 12, owner); faction.intent = `增援 ${dest.name}`;
    }
  }
  if (faction.gold > 300) { const p = barracks.find(p => p.level < 3) ?? factories.find(p => p.level < 3); if (p) upgrade(w, p.id, owner); }
}
