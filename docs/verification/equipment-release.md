# 装备、研究室与建筑流程发布记录

日期：2026-11-11。功能提交：`45859a053241bac3b079e30bcdeb630c12cec596`，已推送 GitHub `main`。游戏规则版本：`2bdedc91e525a6af`。

正式入口：[铸造前线](https://czhtbs.ykcryobs.cn/forgefront)。

## 发布内容

装备与属性面板、单一附加弹药和完整伤害配件、两类护甲、三个战术芯片、四类工厂、研究室与 30 项科技；科技全军即时生效。八张统一生图建造卡、研究室地图生图、研发和分兵教程、额外出生领地、4 秒建筑操作、手动取消全额退款、占领退款及战败建筑清除一起发布。地面火苗数量与大小减少，重叠区域减少重复绘制，伤害规则不变。

## 位置与回退

- 当前目录：`/usr/local/lib/cs-forgefront/current` → `/usr/local/lib/cs-forgefront/releases/20261111-45859a0`。
- 可回退版本：`/usr/local/lib/cs-forgefront/releases/20261110-44dc780`，旧规则版本 `e49e0892e005789d`。
- 完整发布包、发布脚本、清单、Linux 重放输入与结果：`/opt/cs-station-upgrade/forgefront-equipment-20261111-45859a0/`。
- 发布包 SHA-256：`35e9604f6b0e18cb7ead51e143c93d4114eadf59963c80a920d0350b707b852a`。
- 新前端脚本：`assets/index-D2SgRa2S.js`。

切换前确认 `players=0`、`running=false`，只重启 `cs-forgefront.service`，新 PID 为 `2632563`。原有 ws 依赖直接复用，没有下载或安装新依赖。旧静态资源与旧发行目录保留。

网站和 Nginx 配置未修改，主 PID 分别保持 `1175941` 与 `1012`，其他业务与私人数据未改动。[完整清单](equipment-upgrade/release.json)

需要回退时，先通过 Unix socket 的 `/forgefront/play/health` 确认房间无人且没有运行中对局，停止游戏服务、将 `current` 原子切回上述旧目录，再启动游戏服务并核对旧规则版本。不使用首次安装的卸载式回退脚本，不重启站点或 Nginx。

## 验证

- 全量 166 项测试与生产构建通过。
- 浏览器验证装备与科技悬浮信息、8 张建造图片、手动取消与退款、窄屏布局及实际游戏启动。
- Windows Node 24.16.0、Edge 157.0.4341.46、服务器 Linux Node 22.23.4 重放同一 1200 步指令日志，含研发、建造、拆除、取消和中途恢复，摘要均为 `42c8a4ebf8d3210f`。[浏览器记录](equipment-upgrade/checks.json) · [Linux 记录](equipment-upgrade/linux-replay.json)
- 正式 HTTPS 页面、当前脚本、新建造图片、研究室贴图和 WSS 验证通过。两个临时访客完成开局、总部升级、156 步同步与投降，最终摘要一致为 `387b4c6cf048583a`；没有使用注册账号或私人存档。[线上记录](equipment-upgrade/live.json)
- 验证后房间已回收：`players=0`、`running=false`、`resyncs=0`。

未重新进行六客户端长时间带宽压力测试或 Firefox 回放；长期对局平衡仍需持续试玩。
