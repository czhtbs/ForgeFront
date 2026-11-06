import Phaser from 'phaser';
import type { Battle, Point, Province, World, Waypoint, Soldier, Route, Fighter } from '../sim/types.ts';
import { FACTION_COLORS, FORT } from '../sim/types.ts';
import { distance, inside, randomSource, movementPath } from '../sim/map.ts';
import { localTroops, configuredItems, routeRate, marchPath } from '../sim/world.ts';
import { canFight, configuration, unitKey, equipmentKey, WEAPONS } from '../content/equipment.ts';
import { battleFrame, SOLDIER_SIZE } from '../sim/spatial.ts';
import { orderGesture } from '../ui/interaction.ts';
import { lineDistance, routeGeometry, editedWaypoints } from './geometry.ts';
export interface MapActions { select(id: number): void; selectUnits(ids: number[], additive: boolean, province?: number): void; order(to: number, ids: number[]): void; connect(from: number, to: number): void; waypoint(route: number, via: Waypoint[]): void; remove(route: number): void }
interface UnitView { root: Phaser.GameObjects.Container; shadow: Phaser.GameObjects.Ellipse; torso: Phaser.GameObjects.Image; helmet: Phaser.GameObjects.Image; pack: Phaser.GameObjects.Image; gun: Phaser.GameObjects.Image; badge: Phaser.GameObjects.Arc }
interface GroupHit { point: Point; province: number; ids: number[]; owner: number; shipment?: number; radius?: number }
interface Drag { kind: 'pan' | 'army' | 'connect' | 'route'; from: number; ids?: number[]; clicked?: number[]; shipment?: number; time: number; route?: number; index?: number; moving?: boolean; original?: Point[]; x: number; y: number; sx: number; sy: number }
export class MapScene extends Phaser.Scene {
  world!: World;
  selected = -1;
  selectedUnits = new Set<number>();
  selectedRoute = -1;
  selectedWaypoint = -1;
  enabled = false;
  actions!: MapActions;
  fps = 0;
  visibleUnits = 0;
  private land!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Graphics;
  private icons!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private labelIndex = 0;
  private polygons: Phaser.Math.Vector2[][] = [];
  private units: UnitView[] = [];
  private buildings: Phaser.GameObjects.Image[] = [];
  private groupHits: GroupHit[] = [];
  private unitHits: GroupHit[] = [];
  private lineHits: { route: number; a: Point; b: Point; insert: number }[] = [];
  private stamp = -1;
  private drag?: Drag;
  private ready = false;
  constructor() { super('map'); }
  preload() { this.load.image('unit-parts', 'assets/unit-parts.png'); for (const kind of ['fort', 'hq', 'barracks', 'workshop', 'mine']) this.load.svg(kind, `assets/${kind}.svg`, { width: 320, height: 240 }); }
  create() {
    const texture = this.textures.get('unit-parts');
    const frames: [string, number, number, number, number][] = [['torso',57,158,327,188],['helmet',543,143,244,216],['pack',983,121,250,255],['tanks',1410,143,286,216],['mg',31,611,393,119],['sniper',465,616,407,87],['rocket',906,604,406,116],['flame',1357,615,385,108]];
    for (const [name,x,y,width,height] of frames) texture.add(name, 0, x, y, width, height);
    this.cameras.main.setBackgroundColor('#b9dce5');
    this.scale.on('resize', (size: Phaser.Structs.Size, _base: Phaser.Structs.Size, _display: Phaser.Structs.Size, previousWidth: number, previousHeight: number) => {
      const camera = this.cameras.main, x = camera.scrollX + previousWidth / 2, y = camera.scrollY + previousHeight / 2;
      camera.setViewport(0, 0, size.width, size.height);
      camera.centerOn(x, y);
    });
    this.land = this.add.graphics(); this.overlay = this.add.graphics().setDepth(3); this.effects = this.add.graphics().setDepth(4); this.icons = this.add.graphics().setDepth(6);
    this.input.mouse!.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (this.drag?.kind === 'pan' && p.isDown) { this.cameras.main.scrollX = this.drag.sx - (p.x - this.drag.x) / this.cameras.main.zoom; this.cameras.main.scrollY = this.drag.sy - (p.y - this.drag.y) / this.cameras.main.zoom; } });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.on('pointerupoutside', () => this.cancelDrag());
    this.game.events.on('blur', () => this.cancelDrag());
    this.game.canvas.addEventListener('pointercancel', () => this.cancelDrag());
    this.input.on('wheel', (p: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (!this.enabled) return;
      const camera = this.cameras.main, before = camera.getWorldPoint(p.x, p.y);
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy > 0 ? .85 : 1.18), .35, 16));
      const after = camera.getWorldPoint(p.x, p.y); camera.scrollX += before.x - after.x; camera.scrollY += before.y - after.y;
    });
    this.ready = true; if (this.world) this.reset(this.world);
  }
  cancelDrag() { this.drag = undefined; }
  deleteSelected() {
    const r = this.world.routes.find(r => r.id === this.selectedRoute); if (!this.enabled || !r || r.owner !== 0) return;
    if (this.selectedWaypoint >= 0) { this.actions.waypoint(r.id, r.via.filter((_, i) => i !== this.selectedWaypoint)); this.selectedWaypoint = -1; }
    else { this.actions.remove(r.id); this.selectedRoute = -1; }
  }
  private provinceAt(point: Point) { return this.world.provinces.find(p => inside(point, p.polygon)); }
  private fortPoint(p: Province) { const frame = battleFrame(p); return { x: frame.x + FORT.x * frame.scale, y: frame.y + FORT.y * frame.scale }; }
  private routePoints(route: Route, via: Waypoint[] = route.via) {
    const points = routeGeometry(this.world, route, via);
    if (points.length) { points[0].point = this.port(this.world.provinces[route.from]); points[points.length - 1].point = this.fortPoint(this.world.provinces[route.to]); }
    return points;
  }
  private port(p: Province) { const point = this.fortPoint(p), z = this.cameras.main.zoom; return { x: point.x + Math.max(45 / z, SOLDIER_SIZE * 6) * .45 + 8 / z, y: point.y }; }
  private pointerDown(pointer: Phaser.Input.Pointer) {
    if (!this.enabled || !this.world || (pointer.event.target as HTMLElement)?.closest('#sidebar, #line-tools, #menu')) return;
    const c = this.cameras.main, point = c.getWorldPoint(pointer.x, pointer.y);
    const base = { from: -1, time: performance.now(), x: pointer.x, y: pointer.y, sx: c.scrollX, sy: c.scrollY };
    if (pointer.rightButtonDown()) { this.drag = { ...base, kind: 'pan' }; return; }
    if (!pointer.leftButtonDown()) return;
    const p = this.provinceAt(point);
    for (const r of this.world.routes.filter(r => r.owner === 0 && (r.from === this.selected || r.to === this.selected))) {
      const i = r.via.findIndex(v => distance(v, point) * c.zoom < 12);
      if (i >= 0) { this.selectedRoute = r.id; this.selectedWaypoint = i; this.drag = { ...base, kind: 'route', route: r.id, index: i, moving: true, original: this.routePoints(r).map(v => v.point) }; return; }
    }
    const factory = this.world.provinces.find(p => p.owner === 0 && p.building === 'workshop' && distance(this.port(p), point) * c.zoom < 12);
    if (factory) { this.drag = { ...base, kind: 'connect', from: factory.id }; return; }
    const hit = [...this.groupHits, ...this.unitHits].map(h => ({ ...h, distance: distance(h.point, point) * c.zoom })).filter(h => h.radius ? h.distance <= h.radius * c.zoom : Math.abs(h.point.x - point.x) * c.zoom <= 22 && (point.y - h.point.y) * c.zoom >= -22 && (point.y - h.point.y) * c.zoom <= 42).sort((a,b) => a.distance - b.distance)[0];
    if (hit) {
      if (pointer.event.ctrlKey) { if (hit.owner === 0) this.actions.selectUnits(hit.ids, true, hit.province); return; }
      if (!hit.ids.every(id => this.selectedUnits.has(id))) this.actions.selectUnits(hit.ids, false, hit.province);
      if (hit.owner === 0) this.drag = { ...base, kind: 'army', from: hit.province, ids: [...this.selectedUnits], clicked: hit.ids, shipment: hit.shipment };
      else this.actions.selectUnits(hit.ids, false, hit.province);
      return;
    }
    const line = this.lineHits.map(h => ({ ...h, d: lineDistance(point, h.a, h.b) * c.zoom })).filter(h => h.d < 9).sort((a, b) => a.d - b.d)[0];
    if (line) { const r = this.world.routes.find(r => r.id === line.route)!; this.selectedRoute = r.id; this.selectedWaypoint = -1; this.drag = { ...base, kind: 'route', route: r.id, index: line.insert, moving: false, original: this.lineHits.filter(h => h.route === r.id).flatMap(h => [h.a, h.b]) }; return; }
    this.actions.select(p?.id ?? -1);
    if (p) this.drag = { ...base, kind: 'army', from: p.id, ids: localTroops(this.world, p.id, 0).filter(canFight).map(s => s.id) };
  }
  private pointerUp(pointer: Phaser.Input.Pointer) {
    const d = this.drag; this.drag = undefined; if (!d || !this.enabled || d.kind === 'pan') return;
    if (!orderGesture(Math.hypot(pointer.x - d.x, pointer.y - d.y), performance.now() - d.time)) { if (d.clicked) this.actions.selectUnits(d.clicked, false, d.from); return; }
    if ((pointer.event.target as HTMLElement)?.closest('#sidebar, #line-tools, #menu')) return;
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y), p = this.provinceAt(point); if (!p) return;
    if (d.kind === 'army' && p.id !== d.from) this.actions.order(p.id, d.ids!);
    if (d.kind === 'connect') this.actions.connect(d.from, p.id);
    if (d.kind === 'route') {
      const r = this.world.routes.find(r => r.id === d.route); if (!r) return;
      if (!d.moving && d.original!.some((a, i, points) => i && lineDistance(point, points[i - 1], a) * this.cameras.main.zoom <= 8)) return;
      this.actions.waypoint(r.id, editedWaypoints(r.via, { x: point.x, y: point.y, province: p.id }, d.index!, !!d.moving));
    }
  }
  reset(world: World) {
    this.world = world; this.stamp = -1; this.selected = -1; this.selectedUnits.clear(); this.selectedRoute = -1; this.selectedWaypoint = -1; this.cancelDrag();
    if (!this.ready) return;
    this.polygons = world.provinces.map(p => p.polygon.map(v => new Phaser.Math.Vector2(v.x, v.y)));
    this.buildings.forEach(b => b.destroy()); this.buildings = world.provinces.map(p => this.add.image(p.x, p.y, p.building ?? 'fort').setDepth(2));
    this.fit();
  }
  fit() { if (!this.ready) return; const c = this.cameras.main; c.setZoom(Math.min(c.width / 1690, c.height / 1080)); c.centerOn(800, 500); }
  focus(id: number, tactical = false) {
    if (!this.ready) return;
    const p = this.world.provinces[id], c = this.cameras.main;
    const width = Math.max(...p.polygon.map(v => v.x)) - Math.min(...p.polygon.map(v => v.x)), height = Math.max(...p.polygon.map(v => v.y)) - Math.min(...p.polygon.map(v => v.y));
    c.setZoom(tactical ? Math.min(c.width / (width + 70), c.height / (height + 70)) : 2); c.centerOn(p.x, p.y);
  }
  private text(point: Point, content: string, color = '#233d43', size = 16) {
    let label = this.labels[this.labelIndex++];
    if (!label) { label = this.add.text(0, 0, '', { fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '16px', color, backgroundColor: '#f4f7eedd', padding: { x: 3, y: 2 } }).setOrigin(.5).setDepth(7); this.labels.push(label); }
    label.setVisible(true).setPosition(point.x, point.y).setText(content).setColor(color).setFontSize(size).setScale(1 / this.cameras.main.zoom);
  }
  private groupIcon(point: Point, s: Soldier, count: number, selected: boolean) {
    const g = this.icons, z = this.cameras.main.zoom, x = point.x, y = point.y, color = FACTION_COLORS[s.owner];
    g.fillStyle(0xf8faef, .95); g.fillRoundedRect(x - 18 / z, y - 18 / z, 36 / z, 36 / z, 7 / z);
    g.lineStyle((selected ? 3 : 1.5) / z, selected ? 0x173f48 : color); g.strokeRoundedRect(x - 18 / z, y - 18 / z, 36 / z, 36 / z, 7 / z);
    g.fillStyle(canFight(s) ? color : 0xa4a793); g.fillCircle(x, y - 7 / z, 5 / z); g.fillRoundedRect(x - 6 / z, y - 1 / z, 12 / z, 12 / z, 3 / z);
    g.lineStyle(3 / z, color); g.lineBetween(x - 3 / z, y + 9 / z, x - 6 / z, y + 15 / z); g.lineBetween(x + 3 / z, y + 9 / z, x + 6 / z, y + 15 / z);
    if (canFight(s)) {
      g.lineStyle((s.weapon === 'rocket' ? 6 : s.weapon === 'mg' ? 4 : 2.5) / z, 0x344e4b);
      g.lineBetween(x + 8 / z, y + 9 / z, x + 8 / z, y - (s.weapon === 'sniper' ? 15 : 9) / z);
      if (s.weapon === 'flame') { g.fillStyle(0xe8a14c); g.fillTriangle(x + 5 / z, y - 8 / z, x + 11 / z, y - 8 / z, x + 8 / z, y - 16 / z); }
      const colors = { pierce: 0x3e8db3, blast: 0xd78039, gas: 0x86a83d, split: 0x9772b5 };
      s.effects.forEach((effect, i) => { g.fillStyle(colors[effect]); g.fillCircle(x - 13 / z, y + (i * 7 - 10) / z, 3 / z); });
    }
    this.text({ x, y: y + 28 / z }, `${count}`, '#233d43', 16);
    if (s.recruit) { g.fillStyle(s.equipped ? 0xe0b34e : 0x9ba694); g.fillCircle(x - 14 / z, y - 15 / z, 4 / z); }
  }
  private drawLand() {
    const g = this.land; g.clear();
    for (const p of this.world.provinces) {
      const rand = randomSource(p.id * 143 + this.world.settings.seed), poly = this.polygons[p.id];
      g.fillStyle([0xd6e3bf, 0xe9dfbd, 0xc6d8b7, 0xe0dfcf][p.terrain]); g.fillPoints(poly, true);
      if (p.owner >= 0) { g.fillStyle(FACTION_COLORS[p.owner], .17); g.fillPoints(poly, true); }
      g.lineStyle(.85, 0x7e8c7c, .8); g.strokePoints(poly, true);
      // A few reusable marks keep terrain legible at strategic scale.
      for (let i = 0; i < 7; i++) {
        const x = p.x + (rand() - .5) * 150, y = p.y + (rand() - .5) * 110;
        if (!inside({ x, y }, poly)) continue;
        if (p.terrain === 2) { g.fillStyle(0x708d62, .5); g.fillTriangle(x, y - 9, x - 5, y + 4, x + 5, y + 4); g.lineStyle(1, 0x69815c, .4); g.lineBetween(x, y, x, y + 7); }
        else if (p.terrain === 3) { g.fillStyle(0xadb2a1, .65); g.fillTriangle(x - 10, y + 7, x, y - 9, x + 11, y + 7); g.fillStyle(0xf7f6e9, .9); g.fillTriangle(x - 4, y - 2, x, y - 9, x + 5, y - 1); }
        else { g.lineStyle(1, 0xadb599, .3); g.beginPath(); g.arc(x, y, 9 + rand() * 13, Math.PI, Math.PI * 1.8); g.strokePath(); }
      }
    }
    for (const p of this.world.provinces) {
      if (p.owner < 0) continue;
      g.lineStyle(2.3, FACTION_COLORS[p.owner], .9);
      for (let i = 0; i < p.polygon.length; i++) {
        const a = p.polygon[i], b = p.polygon[(i + 1) % p.polygon.length], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const shared = p.neighbors.find(id => this.world.provinces[id].polygon.some((q, j, poly) => lineDistance(mid, q, poly[(j + 1) % poly.length]) < .1));
        if (shared === undefined || this.world.provinces[shared].owner !== p.owner) g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
  }
  private unit(index: number): UnitView {
    if (this.units[index]) return this.units[index];
    const shadow = this.add.ellipse(0, 2, 30, 25, 0x24372a, .2);
    const part = (frame: string, x: number, y: number, size: number) => { const image = this.add.image(x, y, 'unit-parts', frame); return image.setDisplaySize(size, size * image.frame.realHeight / image.frame.realWidth); };
    const pack = part('pack', -6, 0, 26).setRotation(-Math.PI / 2);
    const torso = part('torso', 0, 0, 36).setRotation(-Math.PI / 2);
    const helmet = part('helmet', 1, 0, 17).setRotation(-Math.PI / 2);
    const gun = part('mg', 12, 3, 33);
    const badge = this.add.circle(-1, -11, 3, 0x208a8c);
    const root = this.add.container(0, 0, [shadow, pack, torso, gun, helmet, badge]).setDepth(5);
    const unit = { root, shadow, pack, torso, helmet, gun, badge }; this.units.push(unit); return unit;
  }
  private drawUnits(troops: Soldier[], province: number, index: number, shipment?: number) {
    const camera = this.cameras.main, view = camera.worldView, g = this.effects;
    const groups = new Map<string, number[]>();
    for (const unit of shipment === undefined ? localTroops(this.world, province) : troops) { const key = `${unit.owner}/${unitKey(unit)}`, ids = groups.get(key) ?? []; ids.push(unit.id); groups.set(key, ids); }
    for (const unit of troops) {
      const p = unit.position!;
      if (p.x < view.left - SOLDIER_SIZE || p.x > view.right + SOLDIER_SIZE || p.y < view.top - SOLDIER_SIZE || p.y > view.bottom + SOLDIER_SIZE) continue;
      const angle = unit.angle ?? 0, recoil = (unit as Partial<Fighter>).recoil ?? 0, sprite = this.unit(index++);
      sprite.root.setVisible(true).setPosition(p.x, p.y).setScale(SOLDIER_SIZE / 36).setRotation(angle);
      sprite.shadow.setRotation(-angle); sprite.pack.setVisible(unit.effects.length > 0 || unit.weapon === 'flame').setFrame(unit.weapon === 'flame' ? 'tanks' : 'pack');
      sprite.gun.setVisible(canFight(unit)).setFrame(unit.weapon === 'rifle' ? 'sniper' : unit.weapon).setX(12 - recoil * 4).setScale((unit.weapon === 'rifle' ? 25 : 33) / sprite.gun.frame.realWidth);
      sprite.badge.setFillStyle(FACTION_COLORS[unit.owner]);
      sprite.helmet.setTint(unit.owner === 0 ? 0xffffff : unit.owner === 1 ? 0xf3b7a5 : unit.owner === 2 ? 0xe9d596 : 0xc8b8de);
      this.unitHits.push({ point: p, province, ids: groups.get(`${unit.owner}/${unitKey(unit)}`)!, owner: unit.owner, shipment, radius: SOLDIER_SIZE * .7 });
      if (this.selectedUnits.has(unit.id)) { this.overlay.lineStyle(2 / camera.zoom, 0xffe08a); this.overlay.strokeCircle(p.x, p.y, SOLDIER_SIZE * .6); }
      if (recoil > .6 && unit.weapon !== 'flame') { g.fillStyle(0xffd36a, recoil); g.fillCircle(p.x + Math.cos(angle) * SOLDIER_SIZE * .75, p.y + Math.sin(angle) * SOLDIER_SIZE * .75, SOLDIER_SIZE / 7); }
    }
    return index;
  }
  private drawBattle(b: Battle, index: number) {
    if (!b.models) return index;
    const province = this.world.provinces[b.province], frame = battleFrame(province), g = this.effects, s = frame.scale;
    const point = (p: Point) => ({ x: frame.x + p.x * s, y: frame.y + p.y * s });
    for (const gas of b.clouds) { const p = point(gas); g.fillStyle(0x9baf4b, .22); g.fillCircle(p.x, p.y, gas.radius * s); }
    index = this.drawUnits(b.fighters, b.province, index);
    for (const shot of b.projectiles) { const p = point(shot); g.lineStyle((shot.weapon === 'rocket' ? 3 : 1.7) * s, shot.weapon === 'rocket' ? 0xd8864f : 0xffd886, .95); g.lineBetween(p.x, p.y, p.x - shot.vx * .025 * s, p.y - shot.vy * .025 * s); }
    for (const v of b.visuals) {
      const p = point(v), alpha = v.life / v.max;
      if (v.kind === 'blast') { g.fillStyle(0xf1a24e, alpha * .65); g.fillCircle(p.x, p.y, (1 - alpha) * 48 * s); g.fillStyle(0x6c6a5c, alpha * .25); g.fillCircle(p.x, p.y, (1 - alpha) * 60 * s); }
      else if (v.kind === 'flame') { g.lineStyle(13 * s, 0xffab45, alpha * .7); g.lineBetween(p.x, p.y, p.x + Math.cos(v.angle) * WEAPONS.flame.range * s, p.y + Math.sin(v.angle) * WEAPONS.flame.range * s); }
      else { g.fillStyle(v.kind === 'death' ? 0x617062 : 0xffe8a0, alpha * .7); g.fillEllipse(p.x, p.y, (v.kind === 'death' ? 23 : 9) * s, 12 * s); }
    }
    return index;
  }
  update() {
    if (!this.world || !this.ready) return;
    this.fps = this.game.loop.actualFps;
    if (Math.floor(this.world.tick / 10) !== this.stamp) { this.stamp = Math.floor(this.world.tick / 10); this.drawLand(); }
    const g = this.overlay, c = this.cameras.main, z = c.zoom; g.clear(); this.effects.clear(); this.icons.clear(); this.labelIndex = 0; this.groupHits = []; this.unitHits = []; this.lineHits = [];
    if (!this.world.routes.some(r => r.id === this.selectedRoute)) { this.selectedRoute = -1; this.selectedWaypoint = -1; }
    const shared = new Map<string, number>();
    const geometry = this.world.routes.map(r => ({ r, points: this.routePoints(r) }));
    const segmentKey = (a: Point, b: Point) => `${a.x.toFixed(2)},${a.y.toFixed(2)}:${b.x.toFixed(2)},${b.y.toFixed(2)}`;
    for (const { points } of geometry) for (let i = 1; i < points.length; i++) { const key = segmentKey(points[i - 1].point, points[i].point); shared.set(key, (shared.get(key) ?? 0) + 1); }
    const lanes = new Map<string, number>();
    for (const { r, points } of geometry) {
      const highlighted = r.owner === 0 && (r.from === this.selected || r.to === this.selected);
      const conflict = r.owner === this.world.provinces[r.to].owner && !!configuration(configuredItems(this.world, r.to)).error;
      const color = conflict ? 0xc75d49 : { normal: 0x429868, delayed: 0xc49b32, cut: 0xc26359, idle: 0x94a199 }[r.status];
      if (!points.length) { const a = this.port(this.world.provinces[r.from]), b = this.fortPoint(this.world.provinces[r.to]); g.lineStyle(2 / z, 0xc26359, .6); g.lineBetween(a.x, a.y, b.x, b.y); if (highlighted) this.lineHits.push({ route: r.id, a, b, insert: 0 }); }
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1].point, b = points[i].point, key = segmentKey(a, b), count = shared.get(key)!;
        const lane = lanes.get(key) ?? 0; lanes.set(key, lane + 1);
        const offset = highlighted && count > 1 ? (lane - (count - 1) / 2) * 10 / z : 0;
        const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
        const mid = { x: (a.x + b.x) / 2 - dy / length * offset, y: (a.y + b.y) / 2 + dx / length * offset };
        g.lineStyle((highlighted ? r.id === this.selectedRoute ? 5 : 3.5 : Math.min(8, 2 + 2 * Math.log2(count))) / z, color, highlighted ? 1 : .45);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(mid.x, mid.y); g.lineTo(b.x, b.y); g.strokePath();
        if (highlighted) { this.lineHits.push({ route: r.id, a, b: mid, insert: points[i].insert }, { route: r.id, a: mid, b, insert: points[i].insert }); }
        if (r.status === 'normal' || r.status === 'delayed') { const t = (this.world.time * .25 + i * .2) % 1; const a1 = t < .5 ? a : mid, b1 = t < .5 ? mid : b, t1 = t < .5 ? t * 2 : (t - .5) * 2; g.fillStyle(0xffffff); g.fillCircle(a1.x + (b1.x - a1.x) * t1, a1.y + (b1.y - a1.y) * t1, 2.4 / z); }
        if (highlighted && i === Math.floor(points.length / 2)) this.text(mid, `${routeRate(this.world, r.from).toFixed(2)}/s`, '#376958', 14);
      }
      if (highlighted) for (let i = 0; i < r.via.length; i++) { const v = r.via[i]; g.fillStyle(i === this.selectedWaypoint && r.id === this.selectedRoute ? 0xf3c355 : 0xffffff); g.fillCircle(v.x, v.y, 6 / z); g.lineStyle(2 / z, 0x36786c); g.strokeCircle(v.x, v.y, 6 / z); }
    }
    let unitIndex = 0;
    for (const p of this.world.provinces) {
      const fort = this.fortPoint(p);
      const b = this.world.battles.find(b => b.province === p.id);
      if (p.id === this.selected) { g.fillStyle(0xffffff, .12); g.fillPoints(this.polygons[p.id], true); g.lineStyle(6 / z, 0x203e48); g.strokePoints(this.polygons[p.id], true); g.lineStyle(3 / z, 0xffefae); g.strokePoints(this.polygons[p.id], true); }
      const size = Math.max(45 / z, SOLDIER_SIZE * 6);
      this.buildings[p.id].setTexture(p.building ?? 'fort').setPosition(fort.x, fort.y).setDisplaySize(size, size * .75).setTint(p.owner < 0 ? 0xe0e3d8 : [0xd1fff7, 0xffc7b3, 0xffe1a6, 0xe4d2ff][p.owner]);
      if (p.id === this.selected || this.world.time - p.lastHit < 2) {
        const y = fort.y - size * .48; g.fillStyle(0x2c4745, .8); g.fillRect(fort.x - 30 / z, y, 60 / z, 6 / z); g.fillStyle(0x64b38b); g.fillRect(fort.x - 30 / z, y, 60 / z * Math.max(0, p.hp) / 1000, 6 / z);
      }
      if (p.owner === 0 && p.building === 'workshop') { const port = this.port(p); g.fillStyle(0xfdf8d8); g.fillCircle(port.x, port.y, 8 / z); g.lineStyle(2 / z, 0x287d75); g.strokeCircle(port.x, port.y, 8 / z); g.lineBetween(port.x - 3 / z, port.y, port.x + 3 / z, port.y); }
      const groups = new Map<string, Soldier[]>();
      for (const s of localTroops(this.world, p.id)) { const key = `${s.owner}/${unitKey(s)}`; const list = groups.get(key) ?? []; list.push(s); groups.set(key, list); }
      let i = 0;
      for (const soldiers of groups.values()) {
        const first = soldiers[0], count = soldiers.length, col = i % 3, row = Math.floor(i / 3);
        const point = { x: fort.x + (col - Math.min(groups.size - 1, 2) / 2) * 46 / z, y: fort.y - size * .6 - (row * 65 + 24) / z };
        this.groupIcon(point, first, count, soldiers.some(s => this.selectedUnits.has(s.id)));
        this.groupHits.push({ point, province: p.id, ids: soldiers.map(s => s.id), owner: first.owner }); i++;
      }
      if (b) unitIndex = this.drawBattle(b, unitIndex);
      
    }
    const marchIcons: Point[] = [];
    for (const s of this.world.shipments) {
      const groups = new Map<string, Soldier[]>();
      for (const unit of s.troops) { const key = unitKey(unit), list = groups.get(key) ?? []; list.push(unit); groups.set(key, list); }
      let i = 0;
      for (const troops of groups.values()) {
        const point = { x: s.x + (i - (groups.size - 1) / 2) * 46 / z, y: s.y };
        while (marchIcons.some(p => distance(p, point) * z < 44)) point.y -= 52 / z;
        marchIcons.push(point);
        g.lineStyle(1 / z, FACTION_COLORS[s.owner], .6); g.lineBetween(s.x, s.y, point.x, point.y);
        this.groupIcon(point, troops[0], troops.length, troops.some(t => this.selectedUnits.has(t.id)));
        this.groupHits.unshift({ point, province: -1, ids: troops.map(t => t.id), owner: s.owner, shipment: s.id }); i++;
      }
      if (s.troops.some(t => this.selectedUnits.has(t.id))) { g.lineStyle(2 / z, FACTION_COLORS[s.owner], .65); g.strokePoints([new Phaser.Math.Vector2(s.x, s.y), ...s.path.slice(s.leg + 1).map(id => new Phaser.Math.Vector2(this.world.provinces[id].x, this.world.provinces[id].y))]); }
    }
    for (let i = unitIndex; i < this.units.length; i++) this.units[i].root.setVisible(false);
    this.visibleUnits = unitIndex;
    this.drawDrag();
    for (let i = this.labelIndex; i < this.labels.length; i++) this.labels[i].setVisible(false);
  }
  private drawDrag() {
    const d = this.drag; if (!d || d.kind === 'pan') return;
    const pointer = this.input.activePointer;
    if (!orderGesture(Math.hypot(pointer.x - d.x, pointer.y - d.y), performance.now() - d.time)) return;
    const c = this.cameras.main, mouse = this.input.activePointer, point = c.getWorldPoint(mouse.x, mouse.y), target = this.provinceAt(point), g = this.overlay, z = c.zoom;
    let points: Point[] = [], valid = false;
    if (d.kind === 'route') {
      const r = this.world.routes.find(r => r.id === d.route); if (!r) return;
      const via = target ? editedWaypoints(r.via, { ...point, province: target.id }, d.index!, !!d.moving) : [];
      const path = target ? this.routePoints(r, via) : []; valid = !!path.length;
      points = valid ? path.map(p => p.point) : [this.world.provinces[r.from], point, this.world.provinces[r.to]];
    } else if (d.kind === 'connect') { points = [this.port(this.world.provinces[d.from]), point]; valid = !!target && target.owner === 0 && ['hq', 'barracks'].includes(target.building ?? ''); }
    else {
      const shipment = this.world.shipments.find(s => s.id === d.shipment);
      const path = target ? shipment ? marchPath(this.world, shipment, target.id) : d.from >= 0 ? movementPath(this.world, d.from, target.id, 0) : [] : [];
      valid = !!path.length && !!d.ids?.length;
      const start = shipment ?? (d.from >= 0 ? this.world.provinces[d.from] : point);
      points = path.length ? [start, ...path.map(id => this.world.provinces[id])] : [start, point];
    }
    if (target && valid) { g.lineStyle(3 / z, 0xf9e398); g.strokePoints(this.polygons[target.id], true); }
    const color = valid ? d.kind === 'army' ? 0xe4b847 : 0x358c79 : 0xc56150;
    g.lineStyle((d.kind === 'army' ? 4 : 3) / z, color); g.strokePoints(points.map(p => new Phaser.Math.Vector2(p.x, p.y)));
    if (points.length > 1) { const a = points[points.length - 2], b = points[points.length - 1], angle = Math.atan2(b.y - a.y, b.x - a.x); g.fillStyle(color); g.fillTriangle(b.x, b.y, b.x - Math.cos(angle - .5) * 16 / z, b.y - Math.sin(angle - .5) * 16 / z, b.x - Math.cos(angle + .5) * 16 / z, b.y - Math.sin(angle + .5) * 16 / z); }
  }
}
