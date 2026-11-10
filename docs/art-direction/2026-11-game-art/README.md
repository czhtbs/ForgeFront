# 正式游戏美术资源

正式贴图位于 `public/assets/b-style/`，由 `scripts/build-art.mjs` 生成：

- 建筑与地形原图保存在 `source/`，生成说明见 [manifest.json](manifest.json) 和 [fort-prompt.json](fort-prompt.json)。
- 士兵绘制与源图位于 `scripts/art/`；图集包括六阵营的未装备、步枪和抛射外观，每种四帧后坐。剑的挥舞由正式渲染绘制。
- 军队画像包括未装备、步枪、抛射和剑；阵亡图集保留躯干、头盔、步枪和抛射武器部件。
- 像素画像参考[任天堂官方单位壁纸](https://www.nintendo.co.jp/n08/bgwj/download/index.html)的辨识方式，图标由本项目重画。

本目录的地图和近景图片是历史离线评审画面，不是浏览器截图。当前规则见[装备与火力规则](../../planning/EQUIPMENT-ROADMAP.md)，贴图和交互回归由 `npm test` 检查。
