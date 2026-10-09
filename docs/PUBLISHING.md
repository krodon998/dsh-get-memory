# 开源上架清单（v0.3）

按顺序执行，每步完成后打勾。

## 1. GitHub 仓库（隐的账号）

- [ ] 新建公开仓库（建议名：`dsh-get-memory`，与包名一致），描述写「Get记忆插件：对话开始时自动拉取GitHub指定仓库的内容并注入上下文；对话结束时提取值得长期记住的新信息写回并提交；左栏快捷面板实时查看状态，设置界面进行详细配置」
- [ ] 把本目录（local-plugins/dsh-aire-memory）作为仓库根推送（README / LICENSE 已就绪）
- [ ] 添加 topic：`dsh-plugin`、`deepseek-harness`
- [ ] 发布第一个 Release（v0.3.0）

## 2. npm 发布

- [x] 包名已定：`dsh-get-memory`（本地已改为此名并装载验证）
- [ ] 补充 package.json 元数据：`repository`（GitHub 仓库地址）、`homepage`、`bugs`
- [ ] 本地再验证一遍：插件页、面板、设置页、写回都正常
- [ ] `npm publish`（公开包）

## 3. 上架 DSH 插件目录 / 市场

- [ ] **dsh.so**：按其提交规则登记（PR / 表单），带 GitHub 仓库地址
- [ ] **dsh.works registry**：提交验证（它会核对安装路径与 dsh 版本）
- [ ] **dsh-plugin-radar**：提交收录（issue / PR）
- [ ] **awesome-dsh-plugin**：PR 添加条目
- [ ] **dshmarket**（DSH 内置插件市场）：按市场作者的上架规则提交
- [ ] GitHub topic `dsh-plugin` 已加（第 1 步），目录聚合会自动发现

## 4. 内容与安全提醒

- [ ] README 已是完整使用攻略（令牌逻辑、读写链路、配置表）——发布前过一遍
- [ ] 第三方插件安全提示：在 README 声明「本插件只读写你配置的那一个仓库、令牌只存本机凭据库、绝不写入仓库」，用户放心装
- [ ] 检查无硬编码路径 / 无私有仓库信息泄漏（本插件默认仓库是 krodon998/Aire-memory，开源后人人可见——如果不想公开默认仓库，把它改成占位值，让用户自行配置）

## 5. 版本管理

- [ ] 之后发版流程：改 package.json `version` → `node scripts/build-client.mjs` → 提交 → GitHub Release → npm publish
- [ ] 维护 CHANGELOG.md（从 v0.2.0 开始记录）

## 注意

- 本插件对**任何用户**都可用：装好 → 配置自己的记忆仓库 + 令牌 → 即可把自己的「人设 + 长期记忆」跨端共享。开源文案建议弱化「小艾专用」色彩，突出通用记忆插件定位（隐的仓库恰好是第一个用户）。
