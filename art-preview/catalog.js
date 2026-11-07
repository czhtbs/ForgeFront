export const weapons = ['none', 'rifle', 'mg', 'sniper', 'rocket', 'flame'];
export const weaponNames = ['未装备', '步枪', '机枪', '狙击枪', '火箭筒', '喷火器'];
export const bodyStyles = [
  ['rigged', '正俯视 · 持握修正版', '无手臂躯干＋独立头盔＋武器；前臂随握点弯曲，手掌盖住握柄，后坐时一起移动。切换四向检查或命中演示。']
];
export const uiStyles = [
  ['b', '01 · B 版深色底栏', '供给从左到右排列，点地图建筑可切换详情；点空地收起。'],
  ['light', '02 · 浅色侧栏对照', '同一地图、同一信息，比较侧栏遮挡和阅读顺序。下载按钮已移除。']
];
export const mapStyles = [
  ['composed', '01 · B 版实景地图', '程序生成地块，逐个摆放已拆分的建筑、山脉与树林；使用之前的步兵绘制与持枪结构。滚轮缩放、右键拖动，点击建筑查看。'],
  ['current', '02 · 现有地图 / 建筑', '现有五种 SVG 建筑与简化地表，作为对照。'],
  ['b', '03 · 原有 B 配色对照', '保留旧的程序地表和 SVG 建筑，便于与新素材比较。']
];
export const particles = ['muzzle_01', 'fire_01', 'flame_01', 'smoke_01', 'smoke_04', 'spark_01', 'spark_05', 'scorch_01', 'light_01', 'trace_01'];
export const particleNames = ['枪口', '火焰团', '火苗', '烟尘 1', '烟尘 4', '火花 1', '火花 5', '灼痕', '光斑', '曳光'];
export const buildings = ['hq', 'barracks', 'workshop', 'mine', 'fort'];
export const buildingNames = ['总部', '兵营', '工坊', '金矿', '堡垒'];
export const scenery = ['hq','barracks','workshop','mine','fort','round-fort','peak','ridge','mountains','hills','rocks','pines','trees','coast','stream'];
export const sceneryNames = ['总部','兵营','装备工坊','金矿','方形堡垒','圆形堡垒','独立山峰','低矮山脊','连绵山脉','丘陵','碎石','针叶林','阔叶林','海岸','浅滩'];
export const images = {
  soldier: 'assets/soldier-v2.svg', poison: 'assets/game-icons/lorc/poison-gas.svg',
  ...Object.fromEntries(buildings.map(b => [b, `assets/current/${b}.svg`])),
  ...Object.fromEntries(scenery.map(key=>['scene-'+key,`assets/scenery/${key}.png`])),
  ...Object.fromEntries(particles.map(p => [p, `assets/particle-pack/PNG (Transparent)/${p}.png`]))
};
export function nextIndex(index, direction, length) { return (index+direction+length)%length; }
export function visibleWeapons(selection) { return selection==='all'?weapons:[selection]; }
