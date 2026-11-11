import type { Item, Payload } from './equipment.ts';

export type ResearchBranch = Payload | 'health' | 'haste' | 'mobility';
export interface Technology { id: string; name: string; tab: 'effects' | 'equipment' | 'general'; icon: string; cost: number; seconds: number; benefit: string; prerequisite?: string; branch?: ResearchBranch; level?: number; unlock?: Item[] }
export const TECHNOLOGIES: Technology[] = [];
const branch = (id: ResearchBranch, names: string[], costs: number[], times: number[], benefits: string[]) => names.forEach((name, i) => TECHNOLOGIES.push({ id: `${id}${i + 1}`, name, tab: ['health', 'haste', 'mobility'].includes(id) ? 'general' : 'effects', icon: id, cost: costs[i], seconds: times[i], benefit: benefits[i], prerequisite: i ? `${id}${i}` : undefined, branch: id, level: i + 1 }));
branch('blast', ['高爆填装', '增量装药', '高能爆破'], [140, 280, 520], [25, 45, 70], ['爆炸伤害 40 → 50；范围 8 → 9', '爆炸伤害 50 → 65；范围 9 → 10', '爆炸伤害 65 → 80；范围 10 → 12']);
branch('burn', ['高热燃料', '扩散燃剂', '炽焰燃剂'], [120, 260, 480], [25, 40, 65], ['每次燃烧伤害 10 → 16，每 0.25 秒造成一次伤害', '每次燃烧伤害 16 → 24；范围 10 → 11', '每次燃烧伤害 24 → 34；范围 11 → 12']);
branch('frost', ['冷媒提纯', '低温结晶', '深冻结晶'], [160, 320, 600], [30, 50, 80], ['冻住所需时间 2 → 1.6 秒；冻结时长 1 → 1.1 秒', '冻住所需时间 1.6 → 1.25 秒；冻结时长 1.1 → 1.3 秒；范围 10 → 11', '冻住所需时间 1.25 → 1 秒；冻结时长 1.3 → 1.5 秒；范围 11 → 12']);
branch('arc', ['电容扩充', '多路放电', '过载电网'], [180, 360, 650], [30, 55, 85], ['无视护甲伤害 30 → 36；范围 12 → 13', '无视护甲伤害 36 → 42；电击人数 3 → 4；范围 13 → 14', '无视护甲伤害 42 → 50；电击人数 4 → 5；范围 14 → 15']);
const unlock = (id: string, name: string, items: Item[], cost: number, seconds: number, benefit: string, prerequisite?: string) => TECHNOLOGIES.push({ id, name, tab: 'equipment', icon: items[0], unlock: items, cost, seconds, benefit, prerequisite });
unlock('homing', '目标引导', ['homing'], 100, 20, '追踪：子弹会转向追赶目标，更容易命中移动的敌人。');
unlock('split', '多弹分裂', ['split'], 260, 45, '分裂：子弹命中或飞到终点时分出三颗子弹，继续携带附加弹药效果。');
unlock('trail', '轨迹释放', ['trail'], 280, 45, '留痕：子弹飞行过程中会多次释放附加弹药效果。');
unlock('lob', '弹道抛射', ['lob'], 240, 40, '抛射：子弹可越过沿途敌人，攻击其他地块；敌人太近时无法开火。');
unlock('medium', '复合护板', ['rangedMedium', 'meleeMedium'], 140, 30, '中型防具：分别抵挡远程或近战伤害，每次减伤 20，移动速度降低 10%。');
unlock('heavy', '重型装甲', ['rangedHeavy', 'meleeHeavy'], 340, 60, '重型防具：分别抵挡远程或近战伤害，每次减伤 30，移动速度降低 20%。', 'medium');
unlock('far', '距离控制', ['far'], 140, 25, '远距：尽量在最远射程开火，敌人靠近时后退，适用于普通步枪。');
unlock('near', '抵近压制', ['near'], 100, 20, '近射：一边射击一边靠近敌人，适用于普通步枪。');
unlock('spread', '火力分配', ['spread'], 180, 30, '分火：优先攻击较少友军瞄准的敌人，减少重复集火。');
branch('health', ['体能训练', '战地强化', '极限体魄'], [180, 360, 700], [35, 60, 90], ['步枪兵血量 200 → 230；剑兵血量 400 → 460', '步枪兵血量 230 → 260；剑兵血量 460 → 520', '步枪兵血量 260 → 300；剑兵血量 520 → 600']);
branch('haste', ['战斗熟练', '动作优化', '连续攻击'], [220, 440, 800], [40, 65, 100], ['攻击速度加成 0% → 10%，士兵开火或挥剑更快', '攻击速度加成 10% → 20%，士兵开火或挥剑更快', '攻击速度加成 20% → 30%，士兵开火或挥剑更快']);
branch('mobility', ['行军训练', '步态优化', '快速行军'], [160, 320, 600], [30, 50, 80], ['移动速度加成 0% → 5%，行军和战斗走位更快', '移动速度加成 5% → 10%，行军和战斗走位更快', '移动速度加成 10% → 15%，行军和战斗走位更快']);
export const TECH = Object.fromEntries(TECHNOLOGIES.map(t => [t.id, t]));
export const HEALTH_BONUS = [0, .15, .3, .5];
export const HASTE_BONUS = [0, .1, .2, .3];
export const MOBILITY_BONUS = [0, .05, .1, .15];
export const EFFECT_VALUES = {
  blast: { damage: [40, 50, 65, 80], radius: [8, 9, 10, 12] },
  burn: { damage: [10, 16, 24, 34], radius: [10, 10, 11, 12] },
  frost: { cold: [50, 62.5, 80, 100], duration: [1, 1.1, 1.3, 1.5], radius: [10, 10, 11, 12] },
  arc: { damage: [30, 36, 42, 50], radius: [12, 13, 14, 15], targets: [3, 3, 4, 5] },
};
