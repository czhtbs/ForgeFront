import { WORKSHOP_ITEMS, isWorkshop, itemName, equipmentName, unitKey, canFight } from '../content/equipment.ts';
import type { Item } from '../content/equipment.ts';
import { endMatch, localTroops, productionState, trainingBattle, allTroops } from '../sim/world.ts';
import { submitLocal } from '../sim/commands.ts';
import type { Command } from '../sim/commands.ts';
import type { Lobby } from '../net/protocol.ts';
import { BUILDING_NAMES } from '../sim/types.ts';
import type { Settings, World, Building, Point } from '../sim/types.ts';
import { toggleUnits } from './interaction.ts';
import { MAP_SIZES } from '../sim/map.ts';
import { ROUTE_COLORS, routeNumber } from '../render/geometry.ts';
import type { MapScene } from '../render/MapScene.ts';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const clock = (n: number) => `${Math.floor(n / 60).toString().padStart(2, '0')}:${Math.floor(n % 60).toString().padStart(2, '0')}`;
export class GameUI {
  world!: World;
  player = 0;
  online = false;
  network?: { enter(): void; leave(): void; configure(settings: Settings, ai: number): void; start(): void };
  send: (command: Command) => string | null = command => submitLocal(this.world, this.player, command);
  selected = -1;
  active = false;
  debug = false;
  simulationMs = 0;
  backlog = 0;
  private toastTimer = 0;
  private lastRender = 0;
  private resultShown = false;
  private controlHeld = false;
  private panelMarkup = "";
  private lineMarkup = "";
  constructor(private scene: MapScene, private start: (settings: Settings) => void) {
    document.querySelector('#app')!.innerHTML = `<header class="topbar"><b>铸造前线</b><span id="network-status" role="status"></span><div id="resources"></div><button data-action="overview">全图</button><button data-action="end">结束本局</button></header><main><section id="map" aria-label="战略地图"><div id="line-tools" hidden></div><div id="toast" role="status"></div><div id="debug" hidden></div></section><aside id="sidebar" hidden aria-label="当前选择"></aside></main><section id="menu" class="veil"></section>`;
    document.querySelector('#app')!.addEventListener('contextmenu', event => event.preventDefault(), true);
    document.querySelector('#app')!.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('button, input, select')) this.controlHeld = true;
    }, true);
    window.addEventListener('pointerup', () => { setTimeout(() => { this.controlHeld = false; }, 0); });
    window.addEventListener('pointercancel', () => { this.controlHeld = false; });
    window.addEventListener('blur', () => { this.controlHeld = false; });
    document.querySelector('#app')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]'); if (b && !b.disabled) this.action(b.dataset.action!, b.dataset.id); });
    window.addEventListener('keydown', e => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (!this.active) return;
      if (e.key.toLowerCase() === 'h') this.scene.fit();
      if (e.key === 'F3') { e.preventDefault(); this.debug = !this.debug; }
      if (e.key === 'Escape') { this.scene.cancelDrag(); this.select(-1); }
      if (e.key === 'Delete') this.scene.deleteSelected();
    });
  }
  bind(world: World, player = 0) { this.world = world; this.player = this.scene.player = player; this.selected = -1; this.scene.selected = -1; this.resultShown = false; this.active = true; this.scene.enabled = true; document.querySelector<HTMLElement>('#menu')!.hidden = true; this.render(true); }
  home() {
    if (this.online) { this.network!.leave(); this.online = false; this.player = this.scene.player = 0; this.send = command => submitLocal(this.world, this.player, command); }
    this.active = false; this.scene.enabled = false; this.scene.cancelDrag(); this.select(-1);
    const menu = document.querySelector<HTMLElement>('#menu')!; menu.hidden = false;
    menu.innerHTML = `<div class="menu-card"><p class="eyebrow">FORGEFRONT</p><h1>铸造前线</h1><button class="primary wide" data-action="multiplayer">联机对局</button><button class="wide" data-action="setup">单人对局</button><button class="wide" data-action="training">装备试验场</button></div>`;
  }
  enterNetwork() {
    this.online = true; this.active = false; this.scene.enabled = false;
    document.querySelector('#menu')!.innerHTML = '<div class="menu-card"><h1>联机对局</h1><p data-network-status role="status">连接中</p><button class="wide" data-action="home">返回</button></div>';
    this.network!.enter();
  }
  lobby(lobby: Lobby, player: number) {
    this.player = this.scene.player = player; this.active = false; this.scene.enabled = false;
    const host = lobby.host === player, menu = document.querySelector<HTMLElement>('#menu')!; menu.hidden = false;
    menu.innerHTML = `<div class="menu-card"><h1>联机大厅</h1><p data-network-status role="status"></p><div class="lobby-players">${lobby.players.map(p => `<div class="stat-line"><span>玩家 ${p.player + 1}${p.player === player ? ' · 你' : ''}${p.player === lobby.host ? ' · 房主' : ''}</span><b>${p.connected ? '在线' : '离线'}</b></div>`).join('')}</div><label>地图<select id="room-count" ${host ? '' : 'disabled'}>${MAP_SIZES.map(size => `<option value="${size.count}" ${size.count === lobby.settings.count ? 'selected' : ''}>${size.name} · ${size.count} 地块</option>`).join('')}</select></label><label>AI<select id="room-ai" ${host ? '' : 'disabled'}>${Array.from({ length: 7 - lobby.players.length }, (_, n) => `<option value="${n}" ${n === lobby.ai ? 'selected' : ''}>${n} 名 AI</option>`).join('')}</select></label><label>难度<select id="room-difficulty" ${host ? '' : 'disabled'}>${[['easy', '休闲'], ['normal', '标准'], ['hard', '进取']].map(([value, name]) => `<option value="${value}" ${value === lobby.settings.difficulty ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>种子<input id="room-seed" type="number" value="${lobby.settings.seed}" ${host ? '' : 'disabled'}></label>${host ? '<button class="primary wide" data-action="room-start">开始对局</button>' : ''}<button class="wide" data-action="home">返回</button></div>`;
    if (host) for (const id of ['room-count', 'room-ai', 'room-difficulty', 'room-seed']) document.getElementById(id)!.addEventListener('change', () => this.configureRoom());
  }
  private configureRoom() {
    const value = (id: string) => (document.getElementById('room-' + id) as HTMLInputElement).value;
    this.network!.configure({ count: Number(value('count')), seed: Number(value('seed')), enemies: 1, difficulty: value('difficulty') as Settings['difficulty'] }, Number(value('ai')));
  }
  private setup() {
    document.querySelector('#menu')!.innerHTML = `<div class="menu-card"><h1>开始对局</h1><label>地图<select id="start-count">${MAP_SIZES.map(size => `<option value="${size.count}">${size.name} · ${size.count} 地块</option>`).join('')}</select></label><label>对手<select id="start-enemies">${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n} 名 AI</option>`).join('')}</select></label><label>难度<select id="start-difficulty"><option value="normal">标准</option><option value="easy">休闲</option><option value="hard">进取</option></select></label><label>种子<input id="start-seed" type="number" value="4521"></label><button class="primary wide" data-action="start">进入战区</button><button class="wide" data-action="home">返回</button></div>`;
  }
  select(id: number) { this.selected = id; this.scene.selected = id; this.scene.selectedUnits.clear(); this.scene.selectedRoute = -1; this.scene.selectedWaypoint = -1; this.render(true); }
  selectUnits(ids: number[], additive: boolean, province = -1) {
    this.scene.selectedUnits = toggleUnits(this.scene.selectedUnits, ids, additive);
    this.selected = this.scene.selected = this.scene.selectedUnits.size ? province : -1;
    this.scene.selectedRoute = -1; this.scene.selectedWaypoint = -1; this.render(true);
  }
  order(target: number, ids: number[], point?: Point, targets?: number[]) {
    if (!this.active || this.world.winner !== null) return;
    this.report(this.send({ type: 'armyOrder', units: ids, province: target, point, targets })); this.render(true);
  }
  report(error: string | null) { if (!error) return; const toast = document.querySelector<HTMLElement>('#toast')!; toast.textContent = '×'; toast.setAttribute('aria-label', error); toast.className = 'error show'; this.toastTimer = performance.now() + 1500; }
  private action(action: string, id?: string) {
    if (action === 'home') { this.home(); return; }
    if (action === 'multiplayer') { this.enterNetwork(); return; }
    if (action === 'room-start') { this.configureRoom(); this.network!.start(); return; }
    if (action === 'setup') { this.setup(); return; }
    if (action === 'start') {
      const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
      this.start({ seed: Number(value('start-seed')), count: Number(value('start-count')), enemies: Number(value('start-enemies')), difficulty: value('start-difficulty') as Settings['difficulty'] }); return;
    }
    if (action === 'training') { this.start({ seed: 4521, count: 10, enemies: 1, difficulty: 'normal', training: true }); this.select(this.world.factions[0].hq); return; }
    if (!this.active) return;
    if (action === 'select-route') { this.scene.selectedRoute = Number(id); this.scene.selectedWaypoint = -1; this.render(true); return; }
    if (action === 'overview') { this.scene.fit(); return; }
    if (action === 'end') { if (this.online) this.report(this.send({ type: 'surrender' })); else { endMatch(this.world); this.showResult(true); } return; }
    if (action === 'close') { this.select(-1); return; }
    if (action === 'delete-point') { this.scene.deleteSelected(); return; }
    if (action === 'delete-route') { this.report(this.send({ type: 'disconnect', route: this.scene.selectedRoute })); this.scene.selectedRoute = -1; this.scene.selectedWaypoint = -1; this.render(true); return; }
    if (action === 'reset-route') { this.report(this.send({ type: 'reroute', route: this.scene.selectedRoute, via: [] })); return; }
    const p = this.world.provinces[this.selected]; if (!p || p.owner !== this.player) return;
    if (action === 'build') this.report(this.send({ type: 'build', province: p.id, building: id as Exclude<Building, null | 'hq'> }));
    if (action === 'upgrade') this.report(this.send({ type: 'upgrade', province: p.id }));
    if (action === 'factory-output') this.report(this.send({ type: 'output', province: p.id, item: id as Item }));
    if (action === 'test') {
      const state = productionState(this.world, p.id);
      if (state.error || !canFight(state)) this.report(state.error ?? '先接入步枪或剑');
      else { const target = trainingBattle(this.world, state, Number((document.querySelector('#test-count') as HTMLSelectElement).value)); this.scene.focus(target, true); }
    }
    this.render(true);
  }
  private showResult(abandoned = false) {
    if (!this.online) endMatch(this.world); this.active = false; this.scene.enabled = false; this.scene.cancelDrag(); this.resultShown = true;
    const w = this.world, menu = document.querySelector<HTMLElement>('#menu')!; menu.hidden = false;
    const result = w.result ?? w.factions.map(f => ({ troops: allTroops(w).filter(s => s.owner === f.id && canFight(s)).length, land: w.provinces.filter(p => p.owner === f.id).length }));
    menu.innerHTML = `<div class="menu-card result"><h1>${abandoned ? '主动结束' : w.winner === this.player ? '战役胜利' : '总部失守'}</h1><p>作战时间 ${clock(w.time)}</p><table><thead><tr><th>阵营</th><th>击杀</th><th>阵亡</th><th>兵力</th><th>地块</th></tr></thead><tbody>${w.factions.map(f => `<tr><td>${f.ai ? 'AI ' + (f.id + 1) : '玩家 ' + (f.id + 1)}</td><td>${w.stats[f.id].kills}</td><td>${w.stats[f.id].losses}</td><td>${result[f.id].troops}</td><td>${result[f.id].land}</td></tr>`).join('')}</tbody></table><button class="primary wide" data-action="home">返回菜单</button></div>`;
  }
  update(now: number) {
    if (now > this.toastTimer) document.querySelector('#toast')!.classList.remove('show');
    if (!this.world) return;
    if (now - this.lastRender > 350) { this.lastRender = now; this.render(); }
    const debug = document.querySelector<HTMLElement>('#debug')!; debug.hidden = !this.debug || !this.active;
    if (this.debug) debug.textContent = `${this.scene.fps.toFixed(0)} FPS · 模拟 ${this.simulationMs.toFixed(1)} ms · 实体 ${this.scene.visibleUnits} · 积压 ${this.backlog.toFixed(2)} s`;
    if (this.active && (this.world.winner !== null || this.online && !this.world.factions[this.player]?.alive) && !this.resultShown) this.showResult();
    const tools = document.querySelector<HTMLElement>('#line-tools')!;
    tools.hidden = !this.active || this.scene.selectedRoute < 0;
    const markup = `<span class="route-caption">线路 ${routeNumber(this.world, this.scene.selectedRoute)}</span>` + (this.scene.selectedWaypoint >= 0 ? '<button data-action="delete-point">删除路径点</button>' : '<button data-action="reset-route">恢复最短路</button><button data-action="delete-route">删除连线</button>');
    if (!this.controlHeld && markup !== this.lineMarkup) { tools.innerHTML = markup; this.lineMarkup = markup; }
  }
  render(force = false) {
    if (!this.world) return;
    const w = this.world, p = w.provinces[this.selected], panel = document.querySelector<HTMLElement>('#sidebar')!;
    document.querySelector('#resources')!.innerHTML = `<span>黄金 <b>${Math.floor(w.factions[this.player]?.gold ?? 0)}</b></span><span>军队 <b>${allTroops(w).filter(s => s.owner === this.player && canFight(s)).length}</b></span><span>${clock(w.time)}</span>`;
    const selected = allTroops(w).filter(s => canFight(s) && this.scene.selectedUnits.has(s.id));
    this.scene.selectedUnits = new Set(selected.map(s => s.id));
    const show = (!!p || selected.length > 0) && this.active;
    if (panel.hidden === show) {
      panel.hidden = !show; document.querySelector('main')!.classList.toggle('has-selection', show);
    }
    if (!show) return;
    if (!force && (this.controlHeld || panel.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement!.tagName))) return;
    const own = p?.owner === this.player;
    const title = selected.length ? '部队' : p.building ? BUILDING_NAMES[p.building] : '空地';
    const upgradeButton = !selected.length && own && p.building ? `<button class="upgrade" data-action="upgrade" ${p.level >= 5 || !w.settings.training && w.factions[this.player].gold < p.level * 100 ? 'disabled' : ''}>${p.level >= 5 ? 'Lv.5' : `升级 <small>${p.level * 100} 金</small>`}</button>` : '';
    let html = `<div class="panel-head"><h2>${title}${!selected.length && p.building ? `<small>Lv.${p.level}</small>` : ''}</h2>${upgradeButton}<button class="close" data-action="close" aria-label="取消选择">×</button></div><div class="panel-body">`;
    if (selected.length) {
      const groups = new Map<string, typeof selected>();
      for (const s of selected) { const key = `${s.owner}/${unitKey(s)}`, list = groups.get(key) ?? []; list.push(s); groups.set(key, list); }
      html += `<p class="big-number">${selected.length} 人</p>`;
      for (const soldiers of groups.values()) html += `<div class="stat-line"><span>${esc(equipmentName(soldiers[0]))}</span><b>${soldiers.length}</b></div>`;
      const moving = w.shipments.reduce((n, s) => n + s.troops.filter(t => this.scene.selectedUnits.has(t.id)).length, 0);
      if (moving) html += `<div class="stat-line"><span>行军</span><b>${moving}</b></div>`;
    } else {
      const troops = localTroops(w, p.id);
      html += `<div class="stat-line"><span>血量</span><b>${Math.ceil(p.hp)} / 1000</b></div><div class="meter"><i style="width:${p.hp / 10}%"></i></div><div class="stat-line"><span>部队</span><b>${troops.length}</b></div>`;
      if (p.building === 'hq' || p.building === 'barracks') html += `<div class="stat-line"><span>可装备</span><b>${troops.filter(s => s.owner === p.owner && s.recruit).length}</b></div>`;
      if (isWorkshop(p.building)) html += `<div class="stat-line"><span>产出</span><b>${itemName(p.output)}</b></div>`;
      const routes = own ? w.routes.filter(r => r.owner === this.player && (r.from === p.id || r.to === p.id)) : [];
      if (routes.length) html += `<div class="route-list">${routes.map(r => {
        const n = routeNumber(w, r.id), chosen = this.scene.selectedRoute === r.id;
        return `<button class="route-choice ${chosen ? 'chosen' : ''}" data-action="select-route" data-id="${r.id}" aria-label="线路 ${n}" aria-pressed="${chosen}" style="--route-color:#${ROUTE_COLORS[(n - 1) % ROUTE_COLORS.length].toString(16).padStart(6, '0')}">${n}</button>`;
      }).join('')}</div>`;
      if (own && !p.building) html += `<div class="choice-list">${(['barracks', 'launcherWorks', 'attachmentWorks', 'mine'] as const).map(kind => {
        const cost = kind === 'barracks' ? 140 : kind === 'mine' ? 160 : 110;
        return `<button class="choice-card" data-action="build" data-id="${kind}" ${!w.settings.training && w.factions[this.player].gold < cost ? 'disabled' : ''}><span class="choice-title">${BUILDING_NAMES[kind]}<small>${cost} 金</small></span><img src="assets/cards/${kind}.svg" alt="" draggable="false"></button>`;
      }).join('')}</div>`;
      if (own && isWorkshop(p.building)) html += `<div class="choice-list">${WORKSHOP_ITEMS[p.building].map(item => `<button class="choice-card ${p.output === item ? 'chosen' : ''}" data-action="factory-output" data-id="${item}" aria-pressed="${p.output === item}"><span class="choice-title">${itemName(item)}</span><img src="assets/cards/${item}.svg" alt="" draggable="false"></button>`).join('')}</div>`;
      if (own && w.settings.training && (p.building === 'hq' || p.building === 'barracks')) html += '<label>规模<select id="test-count"><option value="40">40 × 40</option><option value="120">120 × 120</option><option value="160">160 × 160</option></select></label><button class="wide" data-action="test">试战</button>';
    }
    html += '</div>';
    if (html !== this.panelMarkup) { const scroll = panel.scrollTop; panel.innerHTML = html; panel.scrollTop = scroll; this.panelMarkup = html; }
  }
}
