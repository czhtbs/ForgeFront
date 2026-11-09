import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createWorld, stepWorld, totalTroops, trainingBattle } from '../sim/world.ts';
import { reinforce } from '../sim/combat.ts';
for (const effect of ['pierce', 'burn', 'split'] as const) {
  const scenario = createWorld({ seed: 4521, count: 10, enemies: 1, difficulty: 'normal', training: true });
  trainingBattle(scenario, { weapon: 'launcher', ammo: 'round', effects: [effect] }, 160);
  for (const unit of scenario.battles[0].reserve) unit.deployAt = 0;
  reinforce(scenario, scenario.battles[0]);
  assert.equal(scenario.battles[0].fighters.length, 240);
  let peak = 0, total = 0;
  for (let i = 0; i < 900; i++) { const t = performance.now(); stepWorld(scenario); const ms = performance.now() - t; total += ms; peak = Math.max(peak, ms); }
  console.log(JSON.stringify({ scenario: `240 active + 80 reserves / ${effect}, 30 simulated seconds`, averageStepMs: +(total / 900).toFixed(3), peakStepMs: +peak.toFixed(3), totalMs: Math.round(total) }));
}
const w = createWorld({ seed: 4521, count: 48, enemies: 3, difficulty: 'normal' });
w.factions[0].ai = true;
const start = performance.now(); let peakBattle = 0, maxBattles = 0;
for (let i = 0; i < 30 * 60 * 30 && w.winner === null; i++) {
  stepWorld(w); maxBattles = Math.max(maxBattles, w.battles.length);
  if (i % 300 === 0) {
    for (const p of w.provinces) { assert.ok(p.troops.length <= 60); assert.ok(p.hp >= 0 && p.hp <= 1000); }
    assert.ok(w.factions.every(f => f.gold >= 0));
    for (const b of w.battles) { peakBattle = Math.max(peakBattle, b.fighters.length); assert.ok(b.fighters.length <= 240); }
    const units = [...w.provinces.flatMap(p => [...p.troops, ...p.mobile]), ...w.shipments.flatMap(s => s.troops), ...w.battles.flatMap(b => [...b.fighters, ...b.reserve])];
    assert.ok(units.every(s => Number.isFinite(s.position?.x) && Number.isFinite(s.position?.y)));
    assert.equal(units.length, new Set(units.map(s => s.id)).size);
    assert.equal(units.length, w.factions.reduce((n, f) => n + totalTroops(w, f.id), 0));
  }
}
console.log(JSON.stringify({ scenario: '48 provinces / 4 AI, up to 30 simulated minutes', simulatedMinutes: +(w.time / 60).toFixed(2), elapsedSeconds: +((performance.now() - start) / 1000).toFixed(2), winner: w.winner, maxSimultaneousBattles: maxBattles, peakBattleEntities: peakBattle, factions: w.factions.map(f => ({ name: f.name, alive: f.alive, land: w.provinces.filter(p => p.owner === f.id).length, troops: totalTroops(w, f.id) })) }));
