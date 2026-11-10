# 工具链与资源生成

依赖版本以 `package-lock.json` 为准。本地已验证 Node.js 24.16.0；日常命令入口见项目 README。

运行依赖为 Phaser 和 ws；开发依赖为 TypeScript、Vite，以及资源生成使用的 sharp 和 @napi-rs/canvas。

2026-11-10 核对官方项目与 npm 发布信息后，将资源工具锁定为 sharp 0.35.5、@napi-rs/canvas 1.1.0。常规构建直接使用仓库内的成品素材，不重新生成。

| 资源工具 | 命令 |
| --- | --- |
| 建筑、士兵与画像图集 | `node --experimental-strip-types scripts/build-art.mjs` |
| 静态 SVG 图卡 | `node --experimental-strip-types scripts/build-ui-cards.mjs` |
| 粒子贴图 | `node scripts/build-fx.mjs` |
| 特效动画 | `node --experimental-strip-types scripts/capture-effects.mjs` |
| 图卡画质与体积对照 | `node --experimental-strip-types scripts/prepare-card-comparison.mjs` |

士兵生成输入位于 `scripts/art/`，图卡对照直接读取仓库内 `generated-originals/` 的原图。含中文文字的离线评审工具使用 Windows 微软雅黑字体。

跨浏览器回放和静态界面截图脚本另需 Playwright 与对应测试浏览器；不属于日常测试和构建依赖，说明见[联机设计](planning/联机游戏设计.md)。

官方来源：[Phaser](https://phaser.io/download/archive)、[Vite](https://vite.dev/guide/)、[sharp](https://sharp.pixelplumbing.com/install/)、[canvas](https://github.com/Brooooooklyn/canvas)。
