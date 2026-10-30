# 🐟 大肥鱼玩星露谷物语 · AI 自主农场

> 一个 AI Agent 从零接管《星露谷物语》存档的实验工程：**它自己种地、浇水、钓鱼、卖货、睡觉存档，连续跑了几十个游戏日。**

角色「蓝色小肥鱼」，标准农场，第一年秋季进行中。仓库里是驱动它自动游玩的全套脚本、自制 mod 和踩坑笔记。

**欢迎 fork / star / PR！** 无论你是想让 AI 玩星露谷、想改造自己的自动化脚本，还是单纯看 AI 种田翻车现场，都欢迎。

---

## 🌾 成果一览

| 阶段 | 做了什么 | 结果 |
|---|---|---|
| 春季 | 防风草起步 → 草莓扩种 → 每日浇水/收菜/卖货闭环 | 钱从 500 起步，峰值攒到 **16,319g** |
| 夏季 | 蓝莓 22 株大扩产 + 钓鱼补现金流 | 蓝莓首收 **+3,607g** |
| 秋季 | 蔓越莓 36 + 南瓜 9 起田，后又扩 **33 蔓越莓 + 9 南瓜** | 全场 **90 格作物**，种子投入约 8,600g |
| 工程 | 自研 BehaviorBridge 桥接「行为学」mod | 框选区域批量锄地/清理，**58 格一次锄完** |
| 运维 | day-loop 三日循环 + night-guard 深夜守卫 | 连续自主运行，每天自动存档睡觉 |

**当前存档状态**（第一年 秋17）：钱 2,369g（刚投完 8.6k 种子，正在回血），90 格作物生长中，体力 94/270，3 个木箱存物资。

其他数字：白名单自动卖货（只卖鱼/农作物/垃圾），任务物品绝不误卖（花椰菜为乔迪任务永久保留）；背包满自动清仓存箱；深夜 24:40 前守卫强制回家睡觉。

---

## 🏗️ 架构

```
┌─────────────┐   HTTP :7842   ┌──────────────────────┐
│  day-loop    │ ─────────────▶ │ Remix NagiBridge      │  ← 游戏内 mod
│  night-guard │                │  /state /surroundings │
│  lib.mjs     │                │  /use /warp /sleep …  │
└──────┬──────┘                └──────────┬───────────┘
       │   HTTP :7845                     │
       ▼                                  ▼
┌─────────────┐                ┌──────────────────────┐
│BehaviorBridge│ ─────────────▶ │ BehaviorAutomation    │  ← 框选自动化 mod
│ (自研 C# mod) │   反射调用     │ 选区域→批量锄/收/清   │
└─────────────┘                └──────────────────────┘
       │
       ▼  物理点击（左/右键）
    Stardew 窗口（前景进程校验 + DPI 感知）
```

- **lib.mjs**：核心库。封装移动闭环、面朝、使用工具、浇水、收获、存箱、卖货白名单、行为学桥接、前台互锁、物理点击。
- **day-loop.mjs**：单日流程编排（找箱→清仓→收获→信箱→浇水→补种→扩田→钓鱼→睡觉），一次连玩 3 天，锁文件防并发。
- **night-guard.mjs**：兜底守卫，游戏时间 ≥24:40 或体力 ≤10 强制回家睡觉，防止熬夜昏倒扣钱。
- **behavior-bridge/**：自研 SMAPI mod，把「行为学」mod 的框选自动化暴露成 HTTP 接口（GET /status、POST /select、/pause、/resume、/actions）。

---

## 🚀 快速开始

### 前置
- Stardew Valley 1.6.x + SMAPI 4.x
- [Remix NagiBridge](https://www.nexusmods.com/stardewvalley/mods/26760)（HTTP 游戏控制，默认端口 7842）
- [BehaviorAutomation 行为学](https://www.nexusmods.com/stardewvalley/mods/52289)（框选区域自动化，N 网 52289）
- Fishbot（自动钓鱼）可选
- Node.js ≥ 18

### 安装
1. 把 `src/behavior-bridge/` 编译成 mod 放进 `Mods/`（或用 `dotnet build`），与 BehaviorAutomation 一起启用。
2. 把 `src/*.mjs` 和 `tools/*.ps1` 放到任意工作目录（默认路径 `D:/StardewAI`，可在 lib.mjs 顶部改）。
3. 启动游戏，进存档，确认 `curl http://localhost:7842/state` 与 `curl http://localhost:7845/status` 都通。
4. `node day-loop.mjs` —— AI 开始种田。

> ⚠️ **窗口与前台**：物理点击（开收货箱、右键收获）前必须确认前台窗口是星露谷，脚本里已内置互锁。无人值守时请保持游戏窗口在前台。

---

## 🕳️ 踩坑集锦（详见 [docs/LESSONS.md](docs/LESSONS.md)）

- **锄地假成功**：`/use` 返回 `ok:true` 但地形没变——工具动画没走完不落判定。**唯一可靠锄地 = 行为学框选**。
- **存档级冻结**：`canMove:false` + 时钟停走，会写进存档自愈。修复优先级：强制 `/sleep` > 重启游戏。
- **深夜时间烧穿**：杀掉循环后没人管睡觉，游戏时间会实时烧到凌晨。接管前先看时间，>24:00 先睡。
- **半径静默跳过**：播种检查半径 8、补种半径 14——超出范围的格子**无声跳过**，排查优先怀疑半径。
- **浇水只浇干土**：`watered=true` 保持到次日清晨，重浇纯浪费；按行蛇形扫，别留孤格（孤格要单独跑一趟）。
- **体力预算**：浇水 2/格，270 体力浇 90 格就没了——田规模 ≈ 90 格上限，洒水器是正解。

---

## 🤝 欢迎 Fork

这个项目完全开源（MIT）。你可以：

- **Fork 后改成你自己的存档/角色**——改 `lib.mjs` 里的路径和角色名即可
- **接更多 mod**：BehaviorBridge 的 HTTP 桥模式可以套在任何 mod 上
- **改策略**：`day-loop.mjs` 的单日流程是一份可读的清单，随便换顺序加环节
- **提 Issue/PR**：踩到新坑、发现更好走位、想加新作物，都欢迎

如果这个仓库帮到你，给个 ⭐ 就是最好的鼓励。

---

## 📄 License

MIT © YeStarOne

攻略来源：小黑盒社区帖子（作者 Aaa帅、candor），整理为 AI 可执行清单见 [docs/GUIDE.md](docs/GUIDE.md)。

## Research notes (docs/research/)

11 deep-dive documents compiled from the Stardew Valley wiki while playing:

| Doc | What's inside |
|---|---|
| farm-master-plan.md | **Master plan**: M1 water-freedom → M2 money-freedom → M3 tech-freedom milestones |
| farm-tech-research.md | Tool upgrades, sprinklers, artisan chain, Robin buildings, winter plan |
| xhh-npc-research.md | Gift rules, loved gifts, birthday calendar, loop hooks |
| guide-fishing-mine.md | Fish prices by season, rod progression, mine layers 1-120 |
| guide-winter-spring.md | Winter/spring plan + full Community Center bundle checklist |
| guide-skills-professions.md | Profession choices per skill (Miner→Prospector, Tiller→Artisan, ...) |
| guide-festivals.md | Full festival calendar + what the AI should actually do each day |
| guide-cooking-energy.md | Stamina economy, food buffs that stack, priority recipes |
| guide-museum-geodes.md | Donation rewards (δ Amulet +1 luck, gem replicator), geode rules |
| guide-crops-profit.md | All-season crops g/day table, giant-crop 3x3, crow warning |
| guide-animals.md | Coop/barn economics, mayo/cheese chain, auto-petter dependency |
