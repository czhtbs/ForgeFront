import Phaser from 'phaser';
import './style.css';
import { MapScene } from './render/MapScene.ts';
import { GameUI } from './ui/GameUI.ts';
import { createWorld } from './sim/world.ts';
import { stepLocalWorld } from './sim/lockstep.ts';
import { GameClient } from './net/GameClient.ts';
import { STEP } from './sim/types.ts';
import type { Settings } from './sim/types.ts';
const scene = new MapScene();
let accumulator = 0;
let client: GameClient | undefined;
const ui = new GameUI(scene, (settings: Settings) => { const world = createWorld(settings); accumulator = 0; scene.reset(world); ui.bind(world); });
scene.actions = { select: id => ui.select(id), selectUnits: (ids, additive, province) => ui.selectUnits(ids, additive, province), order: (to, ids, point, targets) => ui.order(to, ids, point, targets), connect: (from, to) => ui.report(ui.send({ type: 'connect', from, to })), waypoint: (route, via) => ui.report(ui.send({ type: 'reroute', route, via })), remove: route => ui.report(ui.send({ type: 'disconnect', route })) };
const networkStatus = (text: string) => { document.querySelector('#network-status')!.textContent = text; const status = document.querySelector('[data-network-status]'); if (status) status.textContent = text; };
ui.network = {
  enter() {
    client = new GameClient({
      lobby: (lobby, player) => ui.lobby(lobby, player),
      start(world, player) { accumulator = 0; scene.reset(world); ui.bind(world, player); scene.focus(world.factions[player].hq); },
      restore(world) { ui.world = world; scene.restore(world); ui.render(true); },
      status: networkStatus, error: error => ui.report(error),
    });
    ui.send = command => client!.command(command); client.connect();
  },
  leave() { client?.leave(); client = undefined; networkStatus(''); },
  configure: (settings, ai) => client!.configure(settings, ai),
  start: () => client!.start(),
};
const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'map', backgroundColor: '#58c8e5', scene: [scene], scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER }, render: { antialias: true, roundPixels: false }, fps: { target: 60 }, audio: { noAudio: true } });
// Single-player is memory-only; multiplayer reconnects to the server's current match.
const initial = createWorld({ seed: 4521, count: 40, enemies: 1, difficulty: 'normal' }); scene.reset(initial); ui.bind(initial); ui.home();
if (sessionStorage.getItem('forgefront-session')) ui.enterNetwork();
let previous = performance.now();
function frame(now: number) {
  const elapsed = (now - previous) / 1000; previous = now;
  if (client) {
    const begin = performance.now(); client.update(elapsed); ui.simulationMs = performance.now() - begin; ui.backlog = client.replica.frames.length * STEP;
  } else if (ui.active && ui.world.winner === null) {
    accumulator += elapsed * ui.simulationSpeed;
    const begin = performance.now(); let steps = 0;
    // Retain elapsed time when a background tab is throttled; never silently skip simulation ticks.
    while (accumulator >= STEP && steps < 180) { stepLocalWorld(ui.world); accumulator -= STEP; steps++; }
    ui.simulationMs = performance.now() - begin; ui.backlog = accumulator;
  } else accumulator = 0;
  ui.update(now); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('error', event => { const toast = document.querySelector<HTMLElement>('#toast'); if (toast) { toast.textContent = `运行错误：${event.message}`; toast.className = 'error show'; } });
window.addEventListener('unhandledrejection', event => { console.error('ForgeFront', event.reason); });
// Keep Phaser managed independently from the fixed-step simulation.
void game;
