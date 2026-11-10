# 地形与反馈评审画面

本目录保存地形、产线、军令箭头和阵亡部件的历史离线评审画面，不是浏览器截图。

当前地形由 `src/render/terrain.ts` 绘制，地块与装饰分别位于 `src/sim/map.ts` 和 `src/render/art.ts`；地图、箭头和阵亡部件的绘制入口为 `src/render/MapScene.ts`。

`scripts/build-art.mjs` 从建筑原图和 `scripts/art/` 中的士兵源图生成贴图，并提取 `src/content/building-hits.ts` 的建筑命中点。

自动检查覆盖地块连通性与尺度、装饰边界、产线选择、箭头、阵亡部件生命周期和建筑命中。当前装备与火力规则见[规则文档](../../planning/EQUIPMENT-ROADMAP.md)。
