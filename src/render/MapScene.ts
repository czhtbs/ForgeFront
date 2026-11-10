import Phaser from 'phaser';
import type { Battle, Point, Province, World, Waypoint, Soldier, Route, Fighter } from '../sim/types.ts';
import { FACTION_COLORS, FORT } from '../sim/types.ts';
import { distance, inside, randomSource, movementPath, mapBounds } from '../sim/map.ts';
import { localTroops, configuredItems, marchPath, allTroops, supplyConflict } from '../sim/world.ts';
import { canFight, configuration, unitKey, isWorkshop, EFFECTS, ARTILLERY_MIN, ARTILLERY_MAX } from '../content/equipment.ts';
import { battleFrame, SOLDIER_SIZE, troopCenter } from '../sim/spatial.ts';
import { attackTargets } from '../sim/attacks.ts';
import { orderGesture, boxUnits, commandUnits } from '../ui/interaction.ts';
import { lineDistance, routeGeometry, editedWaypoints, lineLength, pointAlong, supplyLanes, ROUTE_COLORS, routeNumber, commandRibbon, attackDestination } from './geometry.ts';
import { buildingWidth, decorations, unitFrame, portraitFrame, swordPose, appear, unitDetail, revealedLine, deathFragments } from './art.ts';
import { drawTerrain, terrainCanvasSize } from './terrain.ts';
import { drawDamageEffects, lightning } from './damageEffects.ts';
const vectors = (points: Point[]) => points.map(p => new Phaser.Math.Vector2(p.x, p.y));
const armyKey = (s: Soldier) => `${unitKey(s)}${s.bombard ? `/artillery:${s.bombard.point.x},${s.bombard.point.y}` : ''}`;
export interface MapActions { select(id: number): void; selectUnits(ids: number[], additive: boolean, province?: number): void; order(to: number, ids: number[], point?: Point, targets?: number[]): void; connect(from: number, to: number): void; waypoint(route: number, via: Waypoint[]): void; remove(route: number): void }
interface UnitView { root: Phaser.GameObjects.Image }
interface ArmyIcon { root: Phaser.GameObjects.Container; portrait: Phaser.GameObjects.Image }
interface GroupHit { point: Point; province: number; ids: number[]; owner: number; shipment?: number; radius?: number }
interface Drag { kind: 'pan' | 'select' | 'army' | 'connect' | 'route'; from: number; ids?: number[]; clicked?: number[]; additive?: boolean; moved?: boolean; shipment?: number; time: number; route?: number; index?: number; moving?: boolean; original?: Point[]; x: number; y: number; sx: number; sy: number }
export class MapScene extends Phaser.Scene {
  world!: World;
  player = 0;
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
  private commands!: Phaser.GameObjects.Graphics;
  private stains!: Phaser.GameObjects.Graphics;
  private ground?: Phaser.GameObjects.Image;
  private debris: Phaser.GameObjects.Image[] = [];
  private damageSprites: Phaser.GameObjects.Image[] = [];
  private damageIndex = 0;
  private labels: Phaser.GameObjects.Text[] = [];
  private labelIndex = 0;
  private polygons: Phaser.Math.Vector2[][] = [];
  private units: UnitView[] = [];
  private buildings: Phaser.GameObjects.Image[] = [];
  private scenery: Phaser.GameObjects.Image[] = [];
  private armyIcons: ArmyIcon[] = [];
  private iconIndex = 0;
  private routeBirth = new Map<number, { clock: number; travel: number; last: number }>();
  private ownership = new Map<number, { owner: number; previous: number; changed: number }>();
  private unitMotion = new Map<number, { soldier: Soldier; born: number; seen: number }>();
  private clock = 0;
  private groupHits: GroupHit[] = [];
  private unitHits: GroupHit[] = [];
  private lineHits: { route: number; a: Point; b: Point; insert: number }[] = [];
  private stamp = -1;
  private drag?: Drag;
  private ready = false;
  constructor() { super('map'); }
  preload() {
    this.load.spritesheet('soldier-debris', 'assets/b-style/soldier-debris.png', { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('soldiers', 'assets/b-style/soldiers.png', { frameWidth: 160, frameHeight: 160 });
    this.load.spritesheet('army-portraits', 'assets/b-style/army-portraits.png', { frameWidth: 32, frameHeight: 40 });
    for (const kind of ['hq', 'barracks', 'workshop', 'mine', 'pine', 'tree', 'mountain']) this.load.image(kind, `assets/b-style/${kind}.png`);
    this.load.image('fort', 'assets/b-style/fort.png');
    for (const kind of ['burst', 'flame', 'smoke', 'glow']) this.load.image(`fx-${kind}`, `assets/fx/${kind}.png`);
  }
  create() {
    this.textures.get('army-portraits').setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.cameras.main.setBackgroundColor('#58c8e5');
    this.scale.on('resize', (size: Phaser.Structs.Size, _base: Phaser.Structs.Size, _display: Phaser.Structs.Size, previousWidth: number, previousHeight: number) => {
      const camera = this.cameras.main, x = camera.scrollX + previousWidth / 2, y = camera.scrollY + previousHeight / 2;
      camera.setViewport(0, 0, size.width, size.height);
      camera.centerOn(x, y);
    });
    this.land = this.add.graphics().setDepth(.5); this.overlay = this.add.graphics().setDepth(1); this.stains = this.add.graphics().setDepth(1.2); this.effects = this.add.graphics().setDepth(5); this.commands = this.add.graphics().setDepth(5.5); this.icons = this.add.graphics().setDepth(6);
    this.input.mouse!.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      this.drag.moved ||= Math.hypot(p.x - this.drag.x, p.y - this.drag.y) >= 6;
      if (this.drag.kind === 'pan' && this.drag.moved) { this.cameras.main.scrollX = this.drag.sx - (p.x - this.drag.x) / this.cameras.main.zoom; this.cameras.main.scrollY = this.drag.sy - (p.y - this.drag.y) / this.cameras.main.zoom; }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.on('pointerupoutside', () => this.cancelDrag());
    this.game.events.on('blur', () => this.cancelDrag());
    this.game.canvas.addEventListener('pointercancel', () => this.cancelDrag());
    this.input.on('wheel', (p: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      if (!this.enabled || !dy) return;
      const camera = this.cameras.main;
      // Phaser updates projection matrices during rendering, not when zoom or scroll is assigned.
      camera.preRender(); const before = camera.getWorldPoint(p.x, p.y);
      camera.setZoom(Phaser.Math.Clamp(camera.zoom * (dy > 0 ? .85 : 1.18), .35, 16));
      camera.preRender();
      const after = camera.getWorldPoint(p.x, p.y); camera.scrollX += before.x - after.x; camera.scrollY += before.y - after.y;
      camera.preRender();
    });
    this.ready = true; if (this.world) this.reset(this.world);
  }
  cancelDrag() { this.drag = undefined; }
  deleteSelected() {
    const r = this.world.routes.find(r => r.id === this.selectedRoute); if (!this.enabled || !r || r.owner !== this.player) return;
    if (this.selectedWaypoint >= 0) { this.actions.waypoint(r.id, r.via.filter((_, i) => i !== this.selectedWaypoint)); this.selectedWaypoint = -1; }
    else { this.actions.remove(r.id); this.selectedRoute = -1; }
  }
  private provinceAt(point: Point) { return this.world.provinces.find(p => inside(point, p.polygon)); }
  private commandTarget(point: Point) {
    const z = this.cameras.main.zoom, hit = [...this.groupHits, ...this.unitHits].filter(h => h.owner !== this.player && distance(h.point, point) * z < (h.radius ? h.radius * z : 23)).sort((a, b) => distance(a.point, point) - distance(b.point, point))[0];
    const targets = hit ? attackTargets(this.world).filter(t => hit.ids.includes(t.unit.id) && t.unit.hp > 0) : [];
    const aim = targets[0]?.point ?? point;
    return { point: aim, province: this.provinceAt(aim), ids: targets.map(t => t.unit.id) };
  }
  private fortPoint(p: Province) { const frame = battleFrame(p); return { x: frame.x + FORT.x * frame.scale, y: frame.y + FORT.y * frame.scale }; }
  private routePoints(route: Route, via: Waypoint[] = route.via) {
    return routeGeometry(this.world, route, via);
  }
  private pointerDown(pointer: Phaser.Input.Pointer) {
    if (!this.enabled || !this.world || (pointer.event.target as HTMLElement)?.closest('#sidebar, #line-tools, #menu')) return;
    const c = this.cameras.main, point = c.getWorldPoint(pointer.x, pointer.y);
    const base = { from: -1, time: performance.now(), x: pointer.x, y: pointer.y, sx: c.scrollX, sy: c.scrollY };
    if (pointer.rightButtonDown()) { this.drag = { ...base, kind: 'pan' }; return; }
    if (!pointer.leftButtonDown()) return;
    const p = this.provinceAt(point);
    for (const r of this.world.routes.filter(r => r.owner === this.player && r.id === this.selectedRoute)) {
      const i = r.via.findIndex(v => distance(v, point) * c.zoom < 12);
      if (i >= 0) { this.selectedRoute = r.id; this.selectedWaypoint = i; this.drag = { ...base, kind: 'route', route: r.id, index: i, moving: true, original: this.routePoints(r).map(v => v.point) }; return; }
    }
    const factory = this.world.provinces.find(p => p.owner === this.player && (isWorkshop(p.building) || p.building === 'hq' || p.building === 'barracks') && distance(this.fortPoint(p), point) < buildingWidth(p) / 2);
    if (factory) {
      this.drag = { ...base, kind: this.selected === factory.id && !this.selectedUnits.size ? 'connect' : 'select', from: factory.id, additive: pointer.event.ctrlKey };
      return;
    }
    const hit = [...this.groupHits, ...this.unitHits].map(h => ({ ...h, distance: distance(h.point, point) * c.zoom })).filter(h => h.radius ? h.distance <= h.radius * c.zoom : Math.abs(h.point.x - point.x) * c.zoom <= 22 && (point.y - h.point.y) * c.zoom >= -22 && (point.y - h.point.y) * c.zoom <= 42).sort((a,b) => a.distance - b.distance)[0];
    if (hit) {
      const command = hit.owner === this.player && !pointer.event.ctrlKey;
      if (command && !hit.ids.every(id => this.selectedUnits.has(id))) this.actions.selectUnits(hit.ids, false, hit.province);
      this.drag = { ...base, kind: command ? 'army' : 'select', from: hit.province, ids: [...this.selectedUnits], clicked: hit.ids, shipment: hit.shipment, additive: hit.owner === this.player && pointer.event.ctrlKey };
      return;
    }
    const line = this.lineHits.map(h => ({ ...h, d: lineDistance(point, h.a, h.b) * c.zoom })).filter(h => h.d < 9).sort((a, b) => a.d - b.d)[0];
    if (line) { const r = this.world.routes.find(r => r.id === line.route)!; this.selectedRoute = r.id; this.selectedWaypoint = -1; this.drag = { ...base, kind: 'route', route: r.id, index: line.insert, moving: false, original: this.lineHits.filter(h => h.route === r.id).flatMap(h => [h.a, h.b]) }; return; }
    this.drag = { ...base, kind: 'select', from: p?.id ?? -1, additive: pointer.event.ctrlKey };
  }
  private pointerUp(pointer: Phaser.Input.Pointer) {
    const d = this.drag; this.drag = undefined; if (!d || !this.enabled) return;
    const moved = d.moved || Math.hypot(pointer.x - d.x, pointer.y - d.y) >= 6;
    if (d.kind === 'pan') { if (!moved) this.actions.select(-1); return; }
    if ((pointer.event.target as HTMLElement)?.closest('#sidebar, #line-tools, #menu')) return;
    if (d.kind === 'select') {
      if (moved) {
        const camera = this.cameras.main, ids = boxUnits([...this.groupHits, ...this.unitHits], camera.getWorldPoint(d.x, d.y), camera.getWorldPoint(pointer.x, pointer.y), this.player);
        this.actions.selectUnits(d.additive ? [...new Set([...this.selectedUnits, ...ids])] : ids, false);
      } else if (d.clicked) this.actions.selectUnits(d.clicked, !!d.additive, d.from);
      else this.actions.select(d.from);
      return;
    }
    if (!orderGesture(Math.hypot(pointer.x - d.x, pointer.y - d.y), performance.now() - d.time)) { if (d.clicked) this.actions.selectUnits(d.clicked, false, d.from); return; }
    const point = this.cameras.main.getWorldPoint(pointer.x, pointer.y), command = this.commandTarget(point), p = d.kind === 'army' ? command.province : this.provinceAt(point); if (!p) return;
    if (d.kind === 'army' && (p.id !== d.from || command.ids.length)) {
      const ids = commandUnits(d.ids!, pointer.event.shiftKey);
      if (pointer.event.shiftKey) this.actions.selectUnits(ids, false, d.from);
      this.actions.order(p.id, ids, command.ids.length ? command.point : this.fortPoint(p), command.ids);
    }
    if (d.kind === 'connect' && p.id !== d.from) this.actions.connect(d.from, p.id);
    if (d.kind === 'route') {
      const r = this.world.routes.find(r => r.id === d.route); if (!r) return;
      if (!d.moving && d.original!.some((a, i, points) => i && lineDistance(point, points[i - 1], a) * this.cameras.main.zoom <= 8)) return;
      this.actions.waypoint(r.id, editedWaypoints(r.via, { x: point.x, y: point.y, province: p.id }, d.index!, !!d.moving));
    }
  }
  restore(world: World) {
    this.world = world; this.stamp = -1; this.cancelDrag(); this.unitMotion.clear(); this.routeBirth.clear();
    this.ownership = new Map(world.provinces.map(p => [p.id, { owner: p.owner, previous: p.owner, changed: -10 }]));
  }
  reset(world: World) {
    this.world = world; this.stamp = -1; this.selected = -1; this.selectedUnits.clear(); this.selectedRoute = -1; this.selectedWaypoint = -1; this.cancelDrag();
    this.routeBirth.clear(); this.unitMotion.clear(); this.ownership = new Map(world.provinces.map(p => [p.id, { owner: p.owner, previous: p.owner, changed: -10 }]));
    if (!this.ready) return;
    if (this.ground) { this.ground.destroy(); this.textures.remove('ground'); }
    const size = terrainCanvasSize(world.provinces), texture = this.textures.createCanvas('ground', size.width, size.height)!;
    drawTerrain(texture.getContext(), world.provinces, world.settings.seed); texture.refresh();
    this.ground = this.add.image(0, 0, 'ground').setOrigin(0).setDepth(0);
    this.polygons = world.provinces.map(p => p.polygon.map(v => new Phaser.Math.Vector2(v.x, v.y)));
    this.buildings.forEach(b => b.destroy()); this.buildings = world.provinces.map(p => this.add.image(p.x, p.y, isWorkshop(p.building) ? 'workshop' : p.building ?? 'fort').setDepth(2));
    this.scenery.forEach(image => image.destroy());
    this.scenery = world.provinces.flatMap(p => decorations(p, world.settings.seed)).map(d => this.add.image(d.x, d.y, d.kind).setDisplaySize(d.size, d.size).setAlpha(.83).setDepth(2 + (d.y + d.size * .4) / 10000));
    this.fit();
  }
  fit() { if (!this.ready) return; const c = this.cameras.main, b = mapBounds(this.world.provinces); c.setZoom(Math.min(c.width / (b.width + 120), c.height / (b.height + 120))); c.centerOn(b.x, b.y); }
  focus(id: number, tactical = false) {
    if (!this.ready) return;
    const p = this.world.provinces[id], c = this.cameras.main;
    const width = Math.max(...p.polygon.map(v => v.x)) - Math.min(...p.polygon.map(v => v.x)), height = Math.max(...p.polygon.map(v => v.y)) - Math.min(...p.polygon.map(v => v.y));
    c.setZoom(tactical ? Math.min(c.width / (width + 70), c.height / (height + 70)) : 2); c.centerOn(p.x, p.y);
  }
  private text(point: Point, content: string, color = '#234956', size = 14) {
    let label = this.labels[this.labelIndex++];
    if (!label) { label = this.add.text(0, 0, '', { fontFamily: 'Microsoft YaHei, sans-serif', fontSize: '14px', color, backgroundColor: '#fffdf0eb', padding: { x: 3, y: 1 } }).setOrigin(.5).setDepth(7); this.labels.push(label); }
    label.setVisible(true).setPosition(point.x, point.y).setText(content).setColor(color).setFontSize(size).setScale(1 / this.cameras.main.zoom);
  }
  private groupIcon(point: Point, s: Soldier, count: number, selected: boolean) {
    const g = this.icons, z = this.cameras.main.zoom, x = point.x, y = point.y, color = FACTION_COLORS[s.owner];
    g.fillStyle(0xfffcef, .95); g.fillRoundedRect(x - 20 / z, y - 23 / z, 40 / z, 46 / z, 3 / z);
    g.lineStyle((selected ? 2.5 : 1) / z, selected ? 0x1d777d : color); g.strokeRoundedRect(x - 20 / z, y - 23 / z, 40 / z, 46 / z, 3 / z);
    g.fillStyle(color); g.fillRect(x - 19 / z, y - 22 / z, 3 / z, 44 / z);
    let icon = this.armyIcons[this.iconIndex++];
    if (!icon) {
      const portrait = this.add.image(0, -2, 'army-portraits');
      const root = this.add.container(0, 0, [portrait]).setDepth(6.1);
      icon = { root, portrait }; this.armyIcons.push(icon);
    }
    icon.root.setVisible(true).setPosition(x, y).setScale(1 / z);
    icon.portrait.setFrame(portraitFrame(s));
    const marks = s.effects.slice(0, 2).map(e => EFFECTS[e].name[0]).join('') + (s.effects.length > 2 ? `+${s.effects.length - 2}` : '');
    if (marks) this.text({ x, y: y - 30 / z }, marks, '#294e5b', 10);
    this.text({ x, y: y + 27 / z }, `${count}`, '#244959', 12);
    if (s.recruit) { g.fillStyle(canFight(s) ? 0xe0b34e : 0x9ba694); g.fillRect(x - 18 / z, y - 22 / z, 5 / z, 5 / z); }
  }
  private drawLand() {
    const g = this.land; g.clear();
    for (const p of this.world.provinces) {
      const rand = randomSource(p.id * 143 + this.world.settings.seed), poly = this.polygons[p.id];
      const ownership = this.ownership.get(p.id)!;
      const blend = appear(this.clock - ownership.changed, 1.2);
      if (ownership.previous >= 0 && blend < 1) { g.fillStyle(FACTION_COLORS[ownership.previous], .16 * (1 - blend)); g.fillPoints(poly, true); }
      if (p.owner >= 0) { g.fillStyle(FACTION_COLORS[p.owner], .16 * blend); g.fillPoints(poly, true); }
      g.lineStyle(.65, 0x607755, .65); g.strokePoints(poly, true);
      // A few reusable marks keep terrain legible at strategic scale.
      for (let i = 0; i < 14; i++) {
        const x = p.x + (rand() - .5) * 95, y = p.y + (rand() - .5) * 100;
        if (inside({ x, y }, poly)) { g.lineStyle(.45, 0x536453, .15); g.lineBetween(x, y, x + 2, y - 1); }
      }
    }
    for (const p of this.world.provinces) {
      if (p.owner < 0) continue;
      g.lineStyle(1.3, FACTION_COLORS[p.owner], .9);
      for (let i = 0; i < p.polygon.length; i++) {
        const a = p.polygon[i], b = p.polygon[(i + 1) % p.polygon.length], mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const shared = p.neighbors.find(id => this.world.provinces[id].polygon.some((q, j, poly) => lineDistance(mid, q, poly[(j + 1) % poly.length]) < .1));
        if (shared === undefined || this.world.provinces[shared].owner !== p.owner) g.lineBetween(a.x, a.y, b.x, b.y);
      }
    }
  }
  private unit(index: number): UnitView {
    if (this.units[index]) return this.units[index];
    const root = this.add.image(0, 0, 'soldiers').setOrigin(55 / 160, .5).setDepth(4);
    const unit = { root }; this.units.push(unit); return unit;
  }
  private drawUnits(troops: Soldier[], province: number, index: number, shipment?: number) {
    const camera = this.cameras.main, view = camera.worldView, g = this.effects;
    const groups = new Map<string, number[]>();
    for (const unit of shipment === undefined ? localTroops(this.world, province) : troops) { const key = `${unit.owner}/${armyKey(unit)}`, ids = groups.get(key) ?? []; ids.push(unit.id); groups.set(key, ids); }
    for (const unit of troops) {
      const p = unit.position!;
      if (p.x < view.left - SOLDIER_SIZE || p.x > view.right + SOLDIER_SIZE || p.y < view.top - SOLDIER_SIZE || p.y > view.bottom + SOLDIER_SIZE) continue;
      const angle = unit.angle ?? 0, recoil = (unit as Partial<Fighter>).recoil ?? 0, sprite = this.unit(index++);
      let motion = this.unitMotion.get(unit.id);
      if (!motion) { motion = { soldier: unit, born: this.clock, seen: this.clock }; this.unitMotion.set(unit.id, motion); }
      motion.soldier = { ...unit, position: { ...p } }; motion.seen = this.clock;
      sprite.root.setVisible(true).setPosition(p.x, p.y).setDepth(2 + p.y / 10000).setScale(SOLDIER_SIZE / 60).setRotation(angle).setFrame(unitFrame(unit, recoil)).setAlpha(appear(this.clock - motion.born, .28) * unitDetail(camera.zoom));
      this.unitHits.push({ point: p, province, ids: groups.get(`${unit.owner}/${armyKey(unit)}`)!, owner: unit.owner, shipment, radius: SOLDIER_SIZE * .7 });
      if (unit.weapon === 'hilt') {
        const sword = swordPose(unit, recoil);
        g.lineStyle(.6, 0x3e5359); g.lineBetween(sword.grip.x, sword.grip.y, sword.tip.x, sword.tip.y);
        g.lineStyle(.3, 0xe2eeee); g.lineBetween(sword.grip.x, sword.grip.y, sword.tip.x, sword.tip.y);
        g.lineStyle(.4, 0xc6a66a); g.lineBetween(sword.guardA.x, sword.guardA.y, sword.guardB.x, sword.guardB.y);
        g.lineStyle(.4, 0x746047); g.lineBetween(sword.pommel.x, sword.pommel.y, sword.grip.x, sword.grip.y);
      }
      if (this.selectedUnits.has(unit.id)) { this.overlay.lineStyle(2 / camera.zoom, 0xffe08a); this.overlay.strokeCircle(p.x, p.y, SOLDIER_SIZE * .6); }
      if (recoil > .6 && unit.weapon !== 'hilt') { g.fillStyle(0xffd36a, recoil); g.fillCircle(p.x + Math.cos(angle) * SOLDIER_SIZE * 1.1, p.y + Math.sin(angle) * SOLDIER_SIZE * 1.1, SOLDIER_SIZE / 7); }
    }
    return index;
  }
  private drawCommand(points: Point[], attack: boolean, valid = true, supply = false) {
    const g = this.commands, z = this.cameras.main.zoom, ribbon = commandRibbon(points, z);
    if (!ribbon.face.length) return;
    const color = !valid ? 0xa1aaa6 : supply ? 0x41c6ac : attack ? 0xed6951 : 0xf4c653;
    const side = !valid ? 0x697773 : supply ? 0x217e73 : attack ? 0xa6403e : 0xaa7730;
    g.lineStyle(9 / z, 0x405a51, .2); g.strokePoints(vectors(ribbon.ground.map(p => ({ x: p.x + 2 / z, y: p.y + 5 / z }))), false);
    g.fillStyle(side, .95); g.fillPoints(vectors(ribbon.face.map(p => ({ x: p.x, y: p.y + 3 / z }))), true);
    g.fillStyle(color, .98); g.fillPoints(vectors(ribbon.face), true);
    g.lineStyle(.8 / z, 0xfff6d3, .9); g.strokePoints(vectors(ribbon.ridge), false);
  }
  private drawDeaths() {
    let index = 0; const detail = unitDetail(this.cameras.main.zoom), size = SOLDIER_SIZE;
    for (const death of detail ? this.world.casualties : []) {
      const age = this.world.time - death.time, rand = randomSource(death.id * 417), alpha = 1 - appear(age - 3.8, 1.2);
      this.stains.fillStyle(0x963d32, alpha * .72); this.stains.fillEllipse(death.x, death.y + size * .15, size * .82, size * .5);
      for (let i = 0; i < 8; i++) {
        const angle = death.angle + (rand() - .5) * 2.8, reach = size * (.19 + rand() * .93) * death.force, t = Math.min(1, age / .2), drop = size * (.083 + rand() * .11);
        const x = death.x + Math.cos(angle) * reach * t, y = death.y + Math.sin(angle) * reach * t;
        this.stains.fillStyle(age < .2 ? 0xbe4b39 : 0x923a32, alpha * .8); this.stains.fillEllipse(x, y, drop * 1.5, drop);
      }
      for (const part of deathFragments(death, age)) {
        let sprite = this.debris[index++];
        if (!sprite) { sprite = this.add.image(0, 0, 'soldier-debris'); this.debris.push(sprite); }
        this.stains.fillStyle(0x5b5140, part.alpha * .18); this.stains.fillEllipse(part.x, part.groundY + .7, part.size * .6, part.size * .25);
        sprite.setVisible(true).setFrame(part.frame).setPosition(part.x, part.y).setDisplaySize(part.size, part.size).setRotation(part.angle).setAlpha(part.alpha * detail).setDepth(2 + part.groundY / 10000);
      }
    }
    for (let i = index; i < this.debris.length; i++) this.debris[i].setVisible(false);
  }
  private drawBattle(b: Battle, index: number) {
    return b.models && unitDetail(this.cameras.main.zoom) ? this.drawUnits(b.fighters, b.province, index) : index;
  }
  private stampEffect(texture: string, x: number, y: number, width: number, height: number, tint: number, alpha: number, angle = 0) {
    const view = this.cameras.main.worldView;
    if (x + width < view.left || x - width > view.right || y + height < view.top || y - height > view.bottom) return;
    let sprite = this.damageSprites[this.damageIndex++];
    if (!sprite) { sprite = this.add.image(0, 0, `fx-${texture}`).setDepth(5.8); this.damageSprites.push(sprite); }
    sprite.setTexture(`fx-${texture}`).setVisible(true).setPosition(x, y).setDisplaySize(width, height).setTint(tint).setAlpha(alpha).setRotation(angle);
  }
  private drawAttacks() {
    const g = this.icons, z = this.cameras.main.zoom;
    this.damageIndex = 0;
    drawDamageEffects(this.world, g, (...args) => this.stampEffect(...args));
    for (const p of this.world.projectiles) {
      const lob = p.airborne, total = Math.max(1, distance(p.origin, p.aim)), progress = Math.min(1, distance(p.origin, p) / total), lift = lob && p.phase === 'flight' ? Math.sin(progress * Math.PI) * 25 : 0;
      g.fillStyle(0x324c4b, .25); if (lob) g.fillCircle(p.x, p.y, 2 / z);
      if (p.effects.includes('arc')) {
        const angle = Math.atan2(p.vy, p.vx), length = Math.min(6, distance(p.origin, p));
        lightning(g, { x: p.x - Math.cos(angle) * length, y: p.y - lift - Math.sin(angle) * length }, { x: p.x, y: p.y - lift }, Math.floor(this.world.time * 18) + p.id, 1);
      } else {
        g.lineStyle(lob ? 2 / z : .6, p.effects.includes('frost') ? 0x82dcee : 0xffd37d);
        g.lineBetween(p.x, p.y - lift, p.x - p.vx * .035, p.y - lift - p.vy * .035);
      }
      if (p.phase !== 'flight') { g.lineStyle(1 / z, 0xe4ac4f); g.strokeCircle(p.x, p.y, 3 / z); }
    }
    for (const v of this.world.visuals) {
      const alpha = v.life / v.max;
      if (['arc', 'blast', 'flame', 'frost'].includes(v.kind)) continue;
      g.fillStyle(v.kind === 'fort-hit' ? 0xe5c27c : 0xb24b3f, alpha); g.fillCircle(v.x, v.y, .7);
    }
    for (let i = this.damageIndex; i < this.damageSprites.length; i++) this.damageSprites[i].setVisible(false);
    const troops = allTroops(this.world);
    for (const hit of this.groupHits) {
      const guns = troops.filter(s => hit.ids.includes(s.id) && this.selectedUnits.has(s.id) && s.effects.includes('lob')); if (!guns.length) continue;
      const point = troopCenter(guns); g.lineStyle(1 / z, 0xe49b49, .6); g.strokeCircle(point.x, point.y, ARTILLERY_MIN); g.lineStyle(1 / z, 0x599d83, .7); g.strokeCircle(point.x, point.y, ARTILLERY_MAX);
    }
  }
  update() {
    if (!this.world || !this.ready) return;
    this.fps = this.game.loop.actualFps; this.clock = performance.now() / 1000;
    let changing = false;
    for (const p of this.world.provinces) {
      let state = this.ownership.get(p.id);
      if (!state) { state = { owner: p.owner, previous: p.owner, changed: -10 }; this.ownership.set(p.id, state); }
      if (state.owner !== p.owner) { state.previous = state.owner; state.owner = p.owner; state.changed = this.clock; }
      changing ||= this.clock - state.changed < 1.2;
    }
    if (changing || Math.floor(this.world.tick / 10) !== this.stamp) { this.stamp = Math.floor(this.world.tick / 10); this.drawLand(); }
    const g = this.overlay, c = this.cameras.main, z = c.zoom; g.clear(); this.effects.clear(); this.icons.clear(); this.commands.clear(); this.stains.clear(); this.labelIndex = 0; this.iconIndex = 0; this.groupHits = []; this.unitHits = []; this.lineHits = [];
    const detail = unitDetail(z); this.effects.setAlpha(detail); this.stains.setAlpha(detail);
    if (!this.world.routes.some(r => r.id === this.selectedRoute)) { this.selectedRoute = -1; this.selectedWaypoint = -1; }
    for (const id of this.routeBirth.keys()) if (!this.world.routes.some(r => r.id === id)) this.routeBirth.delete(id);
    for (const { r, points: full, highlighted } of supplyLanes(this.world, this.selected, z, this.player)) {
      if (!this.routeBirth.has(r.id)) this.routeBirth.set(r.id, { clock: this.clock, travel: 0, last: this.world.time });
      const birth = this.routeBirth.get(r.id)!, progress = appear(this.clock - birth.clock, .65);
      if (r.status === 'normal' || r.status === 'delayed') birth.travel += (this.world.time - birth.last) * (r.status === 'delayed' ? 12 : 24);
      birth.last = this.world.time;
      const whole = full.map(v => v.point), points = revealedLine(whole, progress), number = routeNumber(this.world, r.id);
      const conflict = r.owner === this.world.provinces[r.to].owner && !!configuration(configuredItems(this.world, r.to)).error;
      const color = conflict || r.status === 'cut' ? 0xcf5e4e : highlighted ? ROUTE_COLORS[(number - 1) % ROUTE_COLORS.length] : r.status === 'idle' ? 0x91a593 : 0x4eab7a;
      if (!points.length) {
        const a = this.fortPoint(this.world.provinces[r.from]), b = this.fortPoint(this.world.provinces[r.to]);
        g.lineStyle(1.5 / z, 0xc26359, .55); g.lineBetween(a.x, a.y, b.x, b.y); continue;
      }
      const selected = r.id === this.selectedRoute;
      if (selected) { g.lineStyle(7 / z, 0xffffff, .85); g.strokePoints(vectors(points), false); }
      g.lineStyle((selected ? 3.5 : highlighted ? 2.5 : 1.6) / z, color, highlighted ? 1 : .55); g.strokePoints(vectors(points), false);
      if (highlighted) {
        for (let i = 1; i < full.length; i++) this.lineHits.push({ route: r.id, a: full[i - 1].point, b: full[i].point, insert: full[i].insert });
        const label = pointAlong(whole, Math.min(lineLength(whole) * .55, buildingWidth(this.world.provinces[r.from]) * .65 + 20 / z));
        this.text(label, `${number}`, '#294e5b', 11);
      }
      const length = lineLength(whole);
      if (length > 0 && (r.status === 'normal' || r.status === 'delayed')) {
        const travel = birth.travel % length;
        if (travel <= length * progress) { const dot = pointAlong(whole, travel); g.fillStyle(0xffffff); g.fillCircle(dot.x, dot.y, 2.6 / z); }
      }
      if (highlighted && selected) for (let i = 0; i < r.via.length; i++) { const v = r.via[i]; g.fillStyle(i === this.selectedWaypoint ? 0xf3c355 : 0xffffff); g.fillCircle(v.x, v.y, 5 / z); g.lineStyle(1.5 / z, color); g.strokeCircle(v.x, v.y, 5 / z); }
    }
    let unitIndex = 0;
    for (const p of this.world.provinces) {
      const fort = this.fortPoint(p);
      const b = this.world.battles.find(b => b.province === p.id);
      const pulse = .4 + .6 * (Math.sin(this.clock * Math.PI * 2) * .5 + .5);
      if (p.id === this.selected) { g.lineStyle(5 / z, 0xffffff, pulse * .2); g.strokePoints(this.polygons[p.id], true); g.lineStyle(2 / z, 0xffffff, pulse); g.strokePoints(this.polygons[p.id], true); }
      const ownership = this.ownership.get(p.id)!;
      const age = this.clock - ownership.changed;
      if (age < 1.2) { g.lineStyle((1 + age * 3) / z, 0xf5ebc7, 1 - age / 1.2); g.strokePoints(this.polygons[p.id], true); }
      const size = buildingWidth(p), image = this.buildings[p.id];
      image.setTexture(isWorkshop(p.building) ? 'workshop' : p.building ?? 'fort').setPosition(fort.x, fort.y).setDepth(2 + (fort.y + size * .4) / 10000).setDisplaySize(size, size).clearTint();
      if (isWorkshop(p.building)) { image.setTint(p.building === 'launcherWorks' ? 0xf5d19b : 0xc5b4ee); this.text({ x: fort.x, y: fort.y + size * .5 }, p.building === 'launcherWorks' ? '发射器' : '配件', '#314e50', 10); }
      if (p.hp <= 0) image.setTint(0x777777);
      if (p.id === this.selected || this.world.time - p.lastHit < 2) {
        const y = fort.y - size * .48; g.fillStyle(0x2c4745, .8); g.fillRect(fort.x - 30 / z, y, 60 / z, 6 / z); g.fillStyle(0x64b38b); g.fillRect(fort.x - 30 / z, y, 60 / z * Math.max(0, p.hp) / 1000, 6 / z);
      }

      const groups = new Map<string, Soldier[]>();
      for (const s of localTroops(this.world, p.id).filter(canFight)) { const key = `${s.owner}/${armyKey(s)}`; const list = groups.get(key) ?? []; list.push(s); groups.set(key, list); }
      let i = 0;
      for (const soldiers of groups.values()) {
        const first = soldiers[0], count = soldiers.length, col = i % 3, row = Math.floor(i / 3);
        const deployed = soldiers.filter(s => s.bombard), center = deployed.length ? troopCenter(deployed) : fort;
        const point = { x: center.x + (col - Math.min(groups.size - 1, 2) / 2) * 44 / z, y: deployed.length ? center.y - 35 / z : b?.models && z > 2 ? p.y - 44 - row * 61 / z : fort.y - size * .6 - (row * 61 + 28) / z };
        if (deployed.length && distance(point, fort) < size / 2 + 24 / z) point.y = fort.y - size * .6 - (row * 61 + 28) / z;
        this.groupIcon(point, first, count, soldiers.some(s => this.selectedUnits.has(s.id)));
        this.groupHits.push({ point, province: p.id, ids: soldiers.map(s => s.id), owner: first.owner }); i++;
      }
      if (b) {
        unitIndex = this.drawBattle(b, unitIndex);
      } else if (detail) unitIndex = this.drawUnits([...p.troops, ...p.mobile].filter(s => s.bombard), p.id, unitIndex);
      
    }
    const marchIcons: Point[] = [];
    for (const s of this.world.shipments) {
      if (s.transferRoute !== undefined) continue;
      const groups = new Map<string, Soldier[]>();
      for (const unit of s.troops) { const key = armyKey(unit), list = groups.get(key) ?? []; list.push(unit); groups.set(key, list); }
      let i = 0;
      for (const troops of groups.values()) {
        const point = { x: s.x + (i - (groups.size - 1) / 2) * 46 / z, y: s.y };
        while (marchIcons.some(p => distance(p, point) * z < 44)) point.y -= 52 / z;
        marchIcons.push(point);
        g.lineStyle(1 / z, FACTION_COLORS[s.owner], .6); g.lineBetween(s.x, s.y, point.x, point.y);
        this.groupIcon(point, troops[0], troops.length, troops.some(t => this.selectedUnits.has(t.id)));
        this.groupHits.unshift({ point, province: -1, ids: troops.map(t => t.id), owner: s.owner, shipment: s.id }); i++;
      }
      if (s.troops.some(t => this.selectedUnits.has(t.id))) this.drawCommand([s, ...s.path.slice(s.leg + 1).map(id => this.world.provinces[id])], attackDestination(this.world, s.to, s.owner));

    }
    const alive = new Set(allTroops(this.world).map(s => s.id));
    for (const [id, motion] of this.unitMotion) {
      if (!detail) { this.unitMotion.delete(id); continue; }
      if (motion.seen === this.clock) continue;
      const elapsed = this.clock - motion.seen;
      if (elapsed > .65) { this.unitMotion.delete(id); continue; }
      const soldier = motion.soldier, p = soldier.position!;
      if (!alive.has(id)) { this.unitMotion.delete(id); continue; }
      const alpha = (1 - appear(elapsed, .65)) * detail, sprite = this.unit(unitIndex++);
      sprite.root.setVisible(true).setPosition(p.x, p.y).setDepth(2 + p.y / 10000).setFrame(unitFrame(soldier)).setScale(SOLDIER_SIZE / 60).setAlpha(alpha).setRotation(soldier.angle ?? 0);
    }
    for (let i = this.iconIndex; i < this.armyIcons.length; i++) this.armyIcons[i].root.setVisible(false);
    for (let i = unitIndex; i < this.units.length; i++) this.units[i].root.setVisible(false);
    this.visibleUnits = unitIndex;
    this.drawAttacks();
    this.drawDeaths();
    this.drawDrag();
    for (let i = this.labelIndex; i < this.labels.length; i++) this.labels[i].setVisible(false);
  }
  private drawDrag() {
    const d = this.drag; if (!d || d.kind === 'pan') return;
    const pointer = this.input.activePointer;
    if (d.kind === 'select') {
      if (!d.moved && Math.hypot(pointer.x - d.x, pointer.y - d.y) < 6) return;
      const c = this.cameras.main, a = c.getWorldPoint(d.x, d.y), b = c.getWorldPoint(pointer.x, pointer.y), g = this.commands;
      g.fillStyle(0x41c6ac, .12); g.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      g.lineStyle(1.5 / c.zoom, 0x41c6ac, .9); g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); return;
    }
    if (!orderGesture(Math.hypot(pointer.x - d.x, pointer.y - d.y), performance.now() - d.time)) return;
    const c = this.cameras.main, mouse = this.input.activePointer, point = c.getWorldPoint(mouse.x, mouse.y), command = this.commandTarget(point), target = d.kind === 'army' ? command.province : this.provinceAt(point), g = this.overlay, z = c.zoom;
    let points: Point[] = [], valid = false;
    if (d.kind === 'route') {
      const r = this.world.routes.find(r => r.id === d.route); if (!r) return;
      const via = target ? editedWaypoints(r.via, { ...point, province: target.id }, d.index!, !!d.moving) : [];
      const path = target ? this.routePoints(r, via) : []; valid = !!path.length;
      points = valid ? path.map(p => p.point) : [this.world.provinces[r.from], point, this.world.provinces[r.to]];
    } else if (d.kind === 'connect') {
      valid = !!target && target.owner === this.player && ['hq', 'barracks'].includes(target.building ?? '') && !supplyConflict(this.world, d.from, target.id);
      points = [this.fortPoint(this.world.provinces[d.from]), valid ? this.fortPoint(target!) : point];
    }
    else {
      const shipment = this.world.shipments.find(s => s.id === d.shipment);
      const path = target ? shipment ? marchPath(this.world, shipment, target.id) : d.from >= 0 ? movementPath(this.world, d.from, target.id, this.player) : [] : [];
      valid = !!path.length && !!d.ids?.length;
      const start = shipment ?? (d.from >= 0 ? this.world.provinces[d.from] : point);
      points = path.length ? [start, ...path.slice(shipment && path.length > 1 ? 1 : 0).map(id => this.world.provinces[id])] : [start, point];
      const troops = allTroops(this.world).filter(s => d.ids!.includes(s.id)), guns = troops.filter(s => s.effects.includes('lob'));
      if (target && guns.length === troops.length && guns.length && (target.owner !== this.player || command.ids.length)) {
        const center = troopCenter(guns), aim = command.ids.length ? command.point : this.fortPoint(target), range = distance(center, aim);
        if (range <= ARTILLERY_MAX) { points = [center, aim]; valid = range >= ARTILLERY_MIN; }
      }
    }
    if (target && valid) { g.lineStyle(3 / z, 0xf9e398); g.strokePoints(this.polygons[target.id], true); }
    if (d.kind === 'army' || d.kind === 'connect') {
      const attack = d.kind === 'army' && !!target && (command.ids.length > 0 || attackDestination(this.world, target.id, this.player));
      this.drawCommand(points, attack, valid, d.kind === 'connect');
    } else { g.lineStyle(2.5 / z, valid ? 0x279c87 : 0xc56150); g.strokePoints(vectors(points), false); }
  }
}
