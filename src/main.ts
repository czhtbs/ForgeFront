import Phaser from 'phaser';
import './style.css';
import { MapScene } from './render/MapScene.ts';
import { GameUI } from './ui/GameUI.ts';
import { createWorld, stepWorld, connect, reroute, disconnect } from './sim/world.ts';
import { STEP } from './sim/types.ts';
import type { Settings } from './sim/types.ts';
const scene = new MapScene();
let accumulator = 0;
const ui = new GameUI(scene, (settings: Settings) => { const world = createWorld(settings); accumulator = 0; scene.reset(world); ui.bind(world); });
scene.actions = { select: id => ui.select(id), selectUnits: (ids, additive, province) => ui.selectUnits(ids, additive, province), order: (to, ids) => ui.order(to, ids), connect: (from, to) => ui.report(connect(ui.world, from, to)), waypoint: (route, via) => ui.report(reroute(ui.world, route, via)), remove: route => disconnect(ui.world, route) };
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'map', backgroundColor: '#b9dce5', scene: [scene], scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER }, render: { antialias: true, roundPixels: false }, fps: { target: 60 }, audio: { noAudio: true } });
// Deliberately memory-only: refreshing or closing the page ends the session.
const initial = createWorld({ seed: 4521, count: 48, enemies: 1, difficulty: 'normal' }); scene.reset(initial); ui.bind(initial); ui.home();
let previous = performance.now();
function frame(now: number) {
  const elapsed = (now - previous) / 1000; previous = now;
  if (ui.active && ui.world.winner === null) {
    accumulator += elapsed;
    const begin = performance.now(); let steps = 0;
    // Retain elapsed time when a background tab is throttled; never silently skip simulation ticks.
    while (accumulator >= STEP && steps < 180) { stepWorld(ui.world); accumulator -= STEP; steps++; }
    ui.simulationMs = performance.now() - begin; ui.backlog = accumulator;
  } else accumulator = 0;
  ui.update(now); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('error', event => { const toast = document.querySelector<HTMLElement>('#toast'); if (toast) { toast.textContent = `运行错误：${event.message}`; toast.className = 'error show'; } });
window.addEventListener('unhandledrejection', event => { console.error('ForgeFront', event.reason); });
// Keep Phaser managed independently from the fixed-step simulation.
void game;
