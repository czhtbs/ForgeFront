import { canFight } from '../content/equipment.ts';
import { distance } from '../sim/map.ts';
import type { World } from '../sim/types.ts';

export class Tutorial {
  step = 0;
  private splitDone = false;
  private w: World;
  get speed() { return this.step === 7 ? 16 : [5, 11, 14].includes(this.step) ? 8 : 1; }
  steps: { text: string; province: number; done: (selected: number) => boolean }[];
  constructor(w: World) {
    this.w = w;
    const home = w.provinces[w.factions[0].hq];
    const mine = w.provinces.find(p => p.owner === 0 && p.building === 'mine')!;
    let incomeStart: number | undefined;
    const plots = w.provinces.filter(p => p.owner === 0 && !p.building).sort((a, b) => distance(a, home) - distance(b, home));
    const plot = plots[0], lab = plots[1];
    const target = w.provinces.filter(p => p.owner < 0 && p.neighbors.some(id => w.provinces[id].owner === 0)).sort((a, b) => distance(a, home) - distance(b, home))[0];
    const supplied = (from: number) => w.routes.some(r => r.from === from && r.to === home.id);
    this.steps = [
      { text: '按住右键拖动地图，滚动滚轮缩放。', province: home.id, done: () => false },
      { text: '点击高亮金矿，观察顶部金币自动增加。', province: mine.id, done: selected => {
        if (selected !== mine.id) return false;
        incomeStart ??= w.factions[0].gold;
        return w.factions[0].gold >= incomeStart + 8;
      } },
      { text: '花费 100 金币升级金矿，提高金币收入。', province: mine.id, done: () => mine.level >= 2 },
      { text: '点击高亮空地，建造发射器工坊。', province: plot.id, done: () => plot.building === 'launcherWorks' && !plot.work && plot.output === 'rifle' },
      { text: '先点选工坊，再从工坊拖出连线到高亮总部。', province: home.id, done: () => supplied(plot.id) },
      { text: '等待六名新兵装备步枪。', province: home.id, done: () => home.troops.filter(canFight).length >= 6 },
      { text: '按住 Shift 拖向高亮地块，派出一半部队。', province: target.id, done: () => this.splitDone },
      { text: '部队会自动作战，等待占领高亮地块。', province: target.id, done: () => target.owner === 0 },
      { text: '在刚占领的地块建造弹药工厂。', province: target.id, done: () => target.building === 'ammoWorks' && !target.work },
      { text: '点击弹药工厂，选择「燃烧」。', province: target.id, done: () => target.output === 'burn' },
      { text: '先点选弹药工厂，再拖出连线到高亮总部。', province: home.id, done: () => supplied(target.id) },
      { text: '等待总部的新兵装上燃烧。', province: home.id, done: () => home.troops.some(s => canFight(s) && s.effects.includes('burn')) },
      { text: '在高亮空地建造研究室。', province: lab.id, done: () => lab.building === 'researchLab' && !lab.work },
      { text: '点击「通用强化」，研发「体能训练」。', province: lab.id, done: () => lab.research?.id === 'health1' || w.factions[0].research.includes('health1') },
      { text: '等待研发完成，所有步兵的血量都会提高。', province: lab.id, done: () => w.factions[0].research.includes('health1') },
      { text: '教程完成，正式对局中攻占敌方总部即可获胜。', province: -1, done: () => false },
    ];
  }
  recordOrder(target: number, ids: number[]) {
    if (this.step !== 6 || target !== this.steps[6].province) return;
    const home = this.w.provinces[this.w.factions[0].hq];
    this.splitDone ||= home.troops.some(canFight) && this.w.shipments.some(s => s.from === home.id && s.to === target && s.troops.some(t => ids.includes(t.id)));
  }
  update(selected: number) {
    if (this.step === 14 && !this.w.provinces[this.steps[13].province].research && !this.w.factions[0].research.includes('health1')) this.step = 13;
    while (this.step < this.steps.length - 1 && this.steps[this.step].done(selected)) this.step++;
  }
}
