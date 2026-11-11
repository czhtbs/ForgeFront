# ForgeFront

在项目根目录运行以下 npm 命令。

| 命令 | 入口说明 |
| --- | --- |
| `npm ci` | 按锁定版本安装依赖 |
| `npm run dev -- --host 127.0.0.1 --port 5180` | 启动开发页面：http://127.0.0.1:5180/ |
| `npm run server` | 启动本地服务器，默认监听 127.0.0.1:5182；开发页面的 WebSocket 转发到此处 |
| `npm test` | 运行自动测试 |
| `npm run build` | 执行类型检查并生成 dist/ |
| `npm run preview -- --host 127.0.0.1 --port 5181` | 预览生产页面：http://127.0.0.1:5181/（先运行 build） |
| `npm run probe` | 运行模拟性能检查 |

运行 `npm run build` 后，`npm run server` 也会在 http://127.0.0.1:5182/ 提供生产页面。

当前本地版本的装备、护甲、战术芯片与研究室升级见 [设计与验收](docs/verification/equipment-upgrade/README.md)。
