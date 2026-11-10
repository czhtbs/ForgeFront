import { canFight } from '../content/equipment.ts';
import { distance } from '../sim/map.ts';
import type { World } from '../sim/types.ts';

export class Tutorial {
  step = 0;
  get speed() { return [5, 7, 11].includes(this.step) ? 8 : 1; }
  steps: { text: string; province: number; done: (selected: number) => boolean }[];
  constructor(w: World) {
    const home = w.provinces[w.factions[0].hq];
    const mine = w.provinces.find(p => p.owner === 0 && p.building === 'mine')!;
    let incomeStart: number | undefined;
    const plot = w.provinces.find(p => p.owner === 0 && !p.building)!;
    const target = w.provinces.filter(p => p.owner < 0 && (home.neighbors.includes(p.id) || plot.neighbors.includes(p.id))).sort((a, b) => distance(a, home) - distance(b, home))[0];
    const supplied = (from: number) => w.routes.some(r => r.from === from && r.to === home.id);
    this.steps = [
      { text: '按住右键拖动地图，滚动滚轮缩放。', province: home.id, done: () => false },
      { text: '点击高亮金矿，观察顶部金币自动增加。', province: mine.id, done: selected => {
        if (selected !== mine.id) return false;
        incomeStart ??= w.factions[0].gold;
        return w.factions[0].gold >= incomeStart + 8;
      } },
      { text: '花费 100 金币升级金矿，提高金币收入。', province: mine.id, done: () => mine.level >= 2 },
      { text: '点击高亮空地，建造发射器工坊。', province: plot.id, done: () => plot.building === 'launcherWorks' && plot.output === 'rifle' },
      { text: '先点选工坊，再从工坊拖出连线到高亮总部。', province: home.id, done: () => supplied(plot.id) },
      { text: '等待六名新兵装备步枪。', province: home.id, done: () => home.troops.filter(canFight).length >= 6 },
      { text: '把总部旁的部队图标拖到高亮地块。', province: target.id, done: () => w.shipments.some(s => s.owner === 0 && s.to === target.id) || w.battles.some(b => b.province === target.id) || target.owner === 0 },
      { text: '部队会自动作战，等待占领高亮地块。', province: target.id, done: () => target.owner === 0 },
      { text: '在刚占领的地块建造配件工坊。', province: target.id, done: () => target.building === 'attachmentWorks' },
      { text: '点击配件工坊，选择「燃烧剂」。', province: target.id, done: () => target.output === 'burn' },
      { text: '先点选配件工坊，再拖出连线到高亮总部。', province: home.id, done: () => supplied(target.id) },
      { text: '等待总部的新兵装上燃烧剂。', province: home.id, done: () => home.troops.some(s => canFight(s) && s.effects.includes('burn')) },
      { text: '教程完成，正式对局中攻占敌方总部即可获胜。', province: -1, done: () => false },
    ];
  }
  update(selected: number) { while (this.step < this.steps.length - 1 && this.steps[this.step].done(selected)) this.step++; }
}
