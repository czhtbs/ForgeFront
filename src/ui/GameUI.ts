import { ITEMS, itemName, equipmentName, unitKey, canFight } from '../content/equipment.ts';
import type { Item } from '../content/equipment.ts';
import { build, connect, dispatch, endMatch, localTroops, productionState, reroute, retreat, trainingBattle, upgrade, disconnect, routeRate, allTroops, orderUnits, setFactoryOutput } from '../sim/world.ts';
import { BUILDING_NAMES } from '../sim/types.ts';
import type { Settings, World } from '../sim/types.ts';
import { toggleUnits } from './interaction.ts';
import { MAP_SIZES } from '../sim/map.ts';
import { ROUTE_COLORS, routeNumber } from '../render/geometry.ts';
import type { MapScene } from '../render/MapScene.ts';
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const clock = (n: number) => `${Math.floor(n / 60).toString().padStart(2, '0')}:${Math.floor(n % 60).toString().padStart(2, '0')}`;
export class GameUI {
  world!: World;
  selected = -1;
  mode: 'production' | 'building' = 'production';
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
    document.querySelector('#app')!.innerHTML = `<header class="topbar"><b>铸造前线</b><div id="resources"></div><button data-action="overview">全图 H</button><button data-action="end">结束本局</button></header><main><section id="map" aria-label="战略地图"><div class="map-help">单击选择 · 拖部队下令 · 拖工坊连补给 · 滚轮缩放 · 右键平移</div><div id="line-tools" hidden></div><div id="toast" role="status"></div><div id="debug" hidden></div></section><aside id="sidebar" hidden aria-label="当前选择"></aside></main><section id="menu" class="veil"></section>`;
    document.querySelector('#app')!.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).closest('button, input, select')) this.controlHeld = true;
    }, true);
    window.addEventListener('pointerup', () => { setTimeout(() => { this.controlHeld = false; }, 0); });
    window.addEventListener('pointercancel', () => { this.controlHeld = false; });
    window.addEventListener('blur', () => { this.controlHeld = false; });
    document.querySelector('#app')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]'); if (b && !b.disabled) this.action(b.dataset.action!, b.dataset.id); });
    document.querySelector('#sidebar')!.addEventListener('change', e => {
      const el = e.target as HTMLInputElement;
      if (el.id === 'factory-output') { this.report(setFactoryOutput(this.world, this.selected, el.value as Item), '产出已切换'); this.render(true); }
    });
    window.addEventListener('keydown', e => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (!this.active) return;
      if (e.key.toLowerCase() === 'h') this.scene.fit();
      if (e.key === 'F3') { e.preventDefault(); this.debug = !this.debug; }
      if (e.key === 'Escape') { this.scene.cancelDrag(); this.select(-1); }
      if (e.key === 'Delete') this.scene.deleteSelected();
    });
  }
  bind(world: World) { this.world = world; this.selected = -1; this.scene.selected = -1; this.mode = 'production'; this.resultShown = false; this.active = true; this.scene.enabled = true; document.querySelector<HTMLElement>('#menu')!.hidden = true; this.render(true); }
  home() {
    this.active = false; this.scene.enabled = false; this.scene.cancelDrag(); this.select(-1);
    const menu = document.querySelector<HTMLElement>('#menu')!; menu.hidden = false;
    menu.innerHTML = `<div class="menu-card"><p class="eyebrow">FORGEFRONT</p><h1>铸造前线</h1><p>建设工坊，武装肉人，夺取敌方总部。</p><button class="primary wide" data-action="setup">开始对局</button><button class="wide" data-action="training">装备试验场</button><p class="muted">肉人在兵营装配，首次离营后成为军队。<br>工坊连线决定装备，不保留装备库存。</p></div>`;
  }
  private setup() {
    document.querySelector('#menu')!.innerHTML = `<div class="menu-card"><h1>开始对局</h1><label>地图<select id="start-count">${MAP_SIZES.map(size => `<option value="${size.count}">${size.name} · ${size.count} 地块</option>`).join('')}</select></label><label>对手<select id="start-enemies"><option value="1">1 名 AI</option><option value="3">3 名 AI</option></select></label><label>难度<select id="start-difficulty"><option value="normal">标准</option><option value="easy">休闲</option><option value="hard">进取</option></select></label><label>种子<input id="start-seed" type="number" value="4521"></label><button class="primary wide" data-action="start">进入战区</button><button class="wide" data-action="home">返回</button></div>`;
  }
  select(id: number) { this.selected = id; this.scene.selected = id; this.scene.selectedUnits.clear(); this.scene.selectedRoute = -1; this.scene.selectedWaypoint = -1; this.mode = 'production'; this.render(true); }
  selectUnits(ids: number[], additive: boolean, province = -1) {
    this.scene.selectedUnits = toggleUnits(this.scene.selectedUnits, ids, additive);
    this.selected = this.scene.selected = this.scene.selectedUnits.size ? province : -1;
    this.scene.selectedRoute = -1; this.scene.selectedWaypoint = -1; this.render(true);
  }
  order(target: number, ids: number[]) {
    if (!this.active || this.world.winner !== null) return;
    this.report(orderUnits(this.world, ids, target)); this.render(true);
  }
  report(error: string | null, success = '指令已执行') { const toast = document.querySelector<HTMLElement>('#toast')!; toast.textContent = error ?? success; toast.className = error ? 'error show' : 'show'; this.toastTimer = performance.now() + 3000; }
  private action(action: string, id?: string) {
    if (action === 'home') { this.home(); return; }
    if (action === 'setup') { this.setup(); return; }
    if (action === 'start') {
      const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
      this.start({ seed: Number(value('start-seed')), count: Number(value('start-count')), enemies: Number(value('start-enemies')), difficulty: value('start-difficulty') as Settings['difficulty'] }); return;
    }
    if (action === 'training') { this.start({ seed: 4521, count: 10, enemies: 1, difficulty: 'normal', training: true }); this.select(this.world.factions[0].hq); return; }
    if (!this.active) return;
    if (action === 'select-route') { this.scene.selectedRoute = Number(id); this.scene.selectedWaypoint = -1; this.render(true); return; }
    if (action === 'overview') { this.scene.fit(); return; }
    if (action === 'end') { endMatch(this.world); this.showResult(true); return; }
    if (action === 'close') { this.select(-1); return; }
    if (action === 'delete-point') { this.scene.deleteSelected(); return; }
    if (action === 'delete-route') { disconnect(this.world, this.scene.selectedRoute); this.scene.selectedRoute = -1; this.scene.selectedWaypoint = -1; this.render(true); return; }
    if (action === 'reset-route') { this.report(reroute(this.world, this.scene.selectedRoute, [])); return; }
    const p = this.world.provinces[this.selected]; if (!p || p.owner !== 0) return;
    if (action === 'build') this.report(build(this.world, p.id, id as 'barracks' | 'workshop' | 'mine'));
    if (action === 'upgrade') this.report(upgrade(this.world, p.id));
    if (action === 'tab') this.mode = id as typeof this.mode;
    if (action === 'test') {
      const state = productionState(this.world, p.id);
      if (state.error || state.weapon === 'rifle') this.report(state.error ?? '先从工坊连入主武器');
      else { const target = trainingBattle(this.world, state, Number((document.querySelector('#test-count') as HTMLSelectElement).value)); this.scene.focus(target, true); }
    }
    this.render(true);
  }
  private showResult(abandoned = false) {
    endMatch(this.world); this.active = false; this.scene.enabled = false; this.scene.cancelDrag(); this.resultShown = true;
    const w = this.world, menu = document.querySelector<HTMLElement>('#menu')!; menu.hidden = false;
    menu.innerHTML = `<div class="menu-card result"><h1>${abandoned ? '主动结束' : w.winner === 0 ? '战役胜利' : '总部失守'}</h1><p>作战时间 ${clock(w.time)}</p><table><thead><tr><th>阵营</th><th>击杀</th><th>阵亡</th><th>兵力</th><th>地块</th></tr></thead><tbody>${w.factions.map(f => `<tr><td>${f.id === 0 ? '玩家' : 'AI ' + f.id}</td><td>${w.stats[f.id].kills}</td><td>${w.stats[f.id].losses}</td><td>${w.result![f.id].troops}</td><td>${w.result![f.id].land}</td></tr>`).join('')}</tbody></table><p class="muted">兵力统计已装备人员；总部失守后的清理不计入击杀。</p><button class="primary wide" data-action="home">返回菜单</button></div>`;
  }
  update(now: number) {
    if (now > this.toastTimer) document.querySelector('#toast')!.classList.remove('show');
    if (!this.world) return;
    if (now - this.lastRender > 350) { this.lastRender = now; this.render(); }
    const debug = document.querySelector<HTMLElement>('#debug')!; debug.hidden = !this.debug || !this.active;
    if (this.debug) debug.textContent = `${this.scene.fps.toFixed(0)} FPS · 模拟 ${this.simulationMs.toFixed(1)} ms · 实体 ${this.scene.visibleUnits} · 积压 ${this.backlog.toFixed(2)} s`;
    if (this.world.winner !== null && !this.resultShown) this.showResult();
    const tools = document.querySelector<HTMLElement>('#line-tools')!;
    tools.hidden = !this.active || this.scene.selectedRoute < 0;
    const markup = `<span class="route-caption">线路 ${routeNumber(this.world, this.scene.selectedRoute)}</span>` + (this.scene.selectedWaypoint >= 0 ? '<button data-action="delete-point">删除路径点</button>' : '<button data-action="reset-route">恢复最短路</button><button data-action="delete-route">删除连线</button>');
    if (!this.controlHeld && markup !== this.lineMarkup) { tools.innerHTML = markup; this.lineMarkup = markup; }
  }
  render(force = false) {
    if (!this.world) return;
    const w = this.world, p = w.provinces[this.selected], panel = document.querySelector<HTMLElement>('#sidebar')!;
    document.querySelector('#resources')!.innerHTML = `<span>黄金 <b>${Math.floor(w.factions[0].gold)}</b></span><span>军队 <b>${allTroops(w).filter(s => s.owner === 0 && canFight(s)).length}</b></span><span>${clock(w.time)}</span>`;
    const selected = allTroops(w).filter(s => canFight(s) && this.scene.selectedUnits.has(s.id));
    this.scene.selectedUnits = new Set(selected.map(s => s.id));
    const show = (!!p || selected.length > 0) && this.active;
    if (panel.hidden === show) {
      panel.hidden = !show; document.querySelector('main')!.classList.toggle('has-selection', show);
    }
    if (!show) return;
    if (!force && (this.controlHeld || panel.contains(document.activeElement) && ['INPUT', 'SELECT'].includes(document.activeElement!.tagName))) return;
    const own = p?.owner === 0;
    const title = selected.length ? '选中部队' : p.building ? BUILDING_NAMES[p.building] : '堡垒';
    let html = `<div class="panel-head"><h2>${title}</h2><button data-action="close" aria-label="取消选择">×</button></div><div class="panel-body">${p && !selected.length && p.building ? `<img class="building-portrait" src="assets/b-style/${p.building}.png" alt="${title}">` : ''}`;
    if (selected.length) {
      const groups = new Map<string, typeof selected>();
      for (const s of selected) { const key = `${s.owner}/${unitKey(s)}`, list = groups.get(key) ?? []; list.push(s); groups.set(key, list); }
      html += `<p class="big-number">${selected.length} 人</p>`;
      for (const soldiers of groups.values()) { const first = soldiers[0]; html += `<h3>${esc(equipmentName(first))} · ${soldiers.length} 人</h3><p>${first.recruit ? '驻营士兵 · 可继续补装，也可出发' : '军队 · 装备已固定'}</p>`; }
      const moving = w.shipments.reduce((n, s) => n + s.troops.filter(t => this.scene.selectedUnits.has(t.id)).length, 0);
      if (moving) html += `<p>行军中 ${moving} 人 · 可拖动改道</p>`;
      html += '<p class="muted">Ctrl 点击添加选择，再点同一组取消。拖动任一已选图标，为全部已选军队下令。</p>';
    } else {
      html += `<p class="owner">${p.owner < 0 ? '中立' : w.factions[p.owner].name}</p><div class="stat-line"><span>堡垒</span><b>${Math.ceil(p.hp)} / 1000</b></div><div class="meter"><i style="width:${p.hp / 10}%"></i></div>`;
      if (own && p.building && p.building !== 'mine') html += `<div class="tabs"><button class="${this.mode === 'production' ? 'chosen' : ''}" data-action="tab" data-id="production">生产</button><button class="${this.mode === 'building' ? 'chosen' : ''}" data-action="tab" data-id="building">建筑</button></div>`;
      if (own && !p.building) html += `<button class="wide" data-action="build" data-id="barracks">兵营 <span>140 金</span></button><button class="wide" data-action="build" data-id="workshop">工坊 <span>110 金</span></button><button class="wide" data-action="build" data-id="mine">金矿 <span>160 金</span></button>`;
      else if (own && (this.mode === 'building' || p.building === 'mine')) html += `<p>建筑等级 ${p.level} / 5</p>${p.building === 'mine' ? `<p>收入 ${(3 + p.level).toFixed(0)} 金/秒</p>` : ''}${p.level < 5 ? `<button class="wide" data-action="upgrade">升级 <span>${p.level * 100} 金</span></button>` : ''}`;
      else if (own && p.building === 'workshop') {
        const routes = w.routes.filter(r => r.from === p.id && r.owner === 0);
        html += `<label>产出<select id="factory-output">${ITEMS.map(i => `<option value="${i}" ${p.output === i ? 'selected' : ''}>${itemName(i)}</option>`).join('')}</select></label><p>产能 ${(p.level / 4).toFixed(2)} 件/秒</p><p>${routes.length ? `${routes.length} 条连接 · 各 ${routeRate(w, p.id).toFixed(3)} 件/秒` : '无连接 · 产出浪费'}</p><p class="muted">从地图上的工坊建筑直接拖到兵营建筑。所有连接等分，满员与断线的份额浪费。</p>`;
      } else if (own && (p.building === 'hq' || p.building === 'barracks')) {
        const state = productionState(w, p.id), troops = localTroops(w, p.id, 0), naked = troops.filter(s => s.recruit && !s.equipped).length, ready = troops.filter(s => s.recruit && s.equipped).length;
        html += `<div class="stat-line"><span>本地人数</span><b>${troops.length} / 60</b></div><p>未装备肉人 ${naked} · 可补装士兵 ${ready}<br>固定装备军队 ${troops.filter(s => !s.recruit).length}</p><p class="muted">${troops.length >= 60 ? '满员 · 停止生成肉人，继续补装' : `每 ${(3 / (1 + (p.level - 1) * .3)).toFixed(1)} 秒生成一名肉人`}</p><h3>完整配置目标</h3><p>${state.weapon === 'rifle' ? '尚未接入主武器' : esc(equipmentName(state))}</p><p class="notice ${state.error ? 'error' : ''}">${esc(state.status)}${state.rate ? ` · ${state.rate.toFixed(3)} 件/秒` : ''}</p>${state.items.map(i => `<div class="stat-line"><span>${itemName(i)} · 待装 ${state.pending[i] ?? 0}</span><b>${(state.inputs[i] ?? 0).toFixed(3)} 件/秒</b></div>`).join('')}<p class="muted">各装备独立消耗，优先补齐已有装备的士兵。首次离营后固定配置，返回也不再补装。</p>`;
        const groups = new Map<string, typeof troops>();
        for (const s of troops.filter(canFight)) { const key = unitKey(s), list = groups.get(key) ?? []; list.push(s); groups.set(key, list); }
        if (groups.size) html += '<h3>驻留兵种</h3>';
        for (const soldiers of groups.values()) html += `<div class="stat-line"><span>${esc(equipmentName(soldiers[0]))}<small>${soldiers[0].recruit ? ' · 可补装' : ' · 已固定'}</small></span><b>${soldiers.length} 人</b></div>`;
        if (w.settings.training) html += `<label>测试规模<select id="test-count"><option value="40">40 对 40</option><option value="120">120 对 120</option><option value="160">160 对 160</option></select></label><button class="wide" data-action="test">测试当前连线配置</button>`;
      }
      if (!own) html += '<p class="muted">将己方军队拖到这里，摧毁堡垒后占领。</p>';
      const routes = own ? w.routes.filter(r => r.owner === 0 && (r.from === p.id || r.to === p.id)) : [];
      if (routes.length) html += `<h3>补给线路</h3><p class="muted">点击一条线路，地图会单独高亮；再拖动该线可调整路径。</p>${routes.map(r => {
        const n = routeNumber(w, r.id), target = w.provinces[r.from === p.id ? r.to : r.from], chosen = this.scene.selectedRoute === r.id;
        return `<button class="route-choice ${chosen ? 'chosen' : ''}" data-action="select-route" data-id="${r.id}" aria-pressed="${chosen}"><i style="background:#${ROUTE_COLORS[(n - 1) % ROUTE_COLORS.length].toString(16).padStart(6, '0')}"></i><span><b>线路 ${n}</b> · ${esc(itemName(w.provinces[r.from].output))}<small>${r.from === p.id ? '送往' : '来自'} ${target.name} · ${target.building ? BUILDING_NAMES[target.building] : '堡垒'}</small></span></button>`;
      }).join('')}`;
    }
    html += '</div>';
    if (html !== this.panelMarkup) { panel.innerHTML = html; this.panelMarkup = html; }
  }
}
