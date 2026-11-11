# 建造栏生成素材

2026-11-11：八张建造图卡全部使用内置生图工具逐张制作，不以 SVG 替代。统一等距视角、简约低多边形明暗、卡其墙面、灰蓝屋顶与浅绿色背景。

- 原图：`originals/`，按建筑英文标识命名。
- 完整逐图提示词：[prompts.json](prompts.json)。参考现有地图兵营／工坊／金矿／研究室贴图，并以本组发射器工坊作为其他图卡风格参考。
- 游戏素材：`public/assets/buildings/*.webp`，每张 600 × 300，由 `scripts/art/building-cards.mjs` 压缩。
- [实际建造栏截图](../../verification/equipment-upgrade/construction-panel.png)。

兵营、发射器工坊、弹药工厂、配件工厂、战术芯片工厂、护甲工厂、金矿、研究室均已接入。历史 SVG 图卡保留用于旧版美术对照，当前建造栏不再读取它们。
