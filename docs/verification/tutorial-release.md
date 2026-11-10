# 新手教程与边缘出生发布记录

日期：2026-11-10。

代码提交：`44dc780fc7c7fd777270fa99e0876b41433135c1`，已推送 GitHub `main`。

本次发布包括独立新手教程、金矿收入与付费升级教学、等待阶段自动八倍速、40 地块无限金币试验场，以及地图边缘出生。游戏规则版本为 `e49e0892e005789d`。

## 运行位置

- 正式入口：<https://czhtbs.ykcryobs.cn/forgefront>。
- 当前目录：`/usr/local/lib/cs-forgefront/current` → `/usr/local/lib/cs-forgefront/releases/20261110-44dc780`。
- 保留的旧版本：`/usr/local/lib/cs-forgefront/releases/20261110-e067d738586dfbd1`。
- 发布包、执行脚本和切换清单：`/opt/cs-station-upgrade/forgefront-tutorial-20261110-44dc780/`。
- 前端脚本：`index-5sFCTuPh.js`，SHA-256 为 `160d72063427b006c899652f65fc16000b95f98245d25e11fc440b97982c25e8`，服务器文件与本地构建一致。

确认房间为空且没有运行中对局后切换目录，仅重启 `cs-forgefront.service`。沿用原有 ws 依赖，无新增安装或下载；保留旧静态资源。站点与 Nginx 配置未修改，主进程 PID 分别保持 `1175941` 与 `1012`。

## 验证

- 实现阶段全量 134 项测试通过；之后教程等待加速与金币教学改动的 29 项 UI 检查通过，最终生产构建通过。
- 自动教程检查覆盖真实金币收入、升级扣费与增产、工坊生产、行军占领和配件装配；加速等待步骤均在六秒检查预算内完成。
- 正式 HTTPS 页面、当前脚本、SVG 图卡、士兵素材和 WSS 通过已有正式入口探针。
- 两个临时访客完成开局、总部升级、92 步模拟与投降，两端最终摘要均为 `fa8fbf3c187550f0`。未使用注册账号或私人存档。[原始记录](tutorial-live.json)
- 检查结束后房间已回收：`players=0`、`running=false`、`resyncs=0`。

未进行本次版本的真人长局、移动端或跨浏览器回放测试。

## 回退

先通过 Unix socket 的 `/forgefront/play/health` 确认房间无人且没有运行中对局，再停止 `cs-forgefront.service`，将 `current` 原子切回上述保留的旧版本并启动该服务，核对版本恢复为 `e067d738586dfbd1`。不修改站点、Nginx、账号或私人数据；不使用首次安装的卸载式回退脚本。
