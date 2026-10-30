# CSXizhang/star 项目调研 —— 可取功能清单

> 2026-10-30 | 源: github.com/CSXizhang/star(星露谷 AI 伙伴, SMAPI Mod + Python runtime + MCP, v0.3.22, MIT)
> 定位与我们高度同类(同 SMAPI 4.2.1 / 游戏 1.6.15), 但架构不同: 它是**独立伙伴角色**(自带背包/体力, actorMode=companion 可切 player), 走 MCP/WS 协议; 我们是 NagiBridge HTTP 直接控玩家。下面按"值得抄"程度排序。

## 一、立即可取(零架构改动)

1. **⭐BWIKI 双源 wiki 查询通道**(wiki.py): 它的攻略数据源 = stardewvalleywiki.com MediaWiki API + **wiki.biligame.com/stardewvalley/api.php**(中文, 带 TTL 缓存)。**我们今天实测被英维 Cloudflare 403 全挡, 而 BWIKI API 直连 200 通** —— 以后查数据先走 `api.php?action=query&list=search` 再拉页面。
2. **行动日志 + 结果查询(action journal / skill.result.query)**: 每个副作用动作带 idempotencyKey, runtime 重启后可查询原动作终态("unknown≠成功, 未确认不续作")。我们 loop 重启后靠 /state 猜 —— 加一个 `D:/StardewAI/action-journal.jsonl`(动作+参数+终态+回执摘要)即可对账。
3. **结果回执语义铁律**(ingame-execution.md, 与我们踩坑完全互证): "调用结束不代表标题里的数量全部完成"、"结果未知不算零产出"、"部分成功只补剩余, 不重新扣材料"。写进 day-loop 的日志判读规约。
4. **累计账本 vs 有界预览**(plantingEvidence.confirmedWateredCount + batches/recentBatches): 累计值单独存, 预览只给最近批次 —— 我们的日记文件可改成同样结构, 防止每轮复制全量历史。

## 二、低成本可取(小改 day-loop)

5. **增量世界快照**: README 明言"连续对话仅发送变化的游戏状态", 协议带 worldRevision。我们每动作全量拉 /state —— 可以缓存上次快照、只 diff 出提示词, 省 token 又省轮次。
6. **save 级结构化记忆**(companion_memory.py): 按 saveId 分区, 条目分 kind(约定/事件/方法/偏好), 支持 修订(correct)/废除(revoke)/取代(supersede), 冲突时修订并注明来源。比我们的自由文本日记更抗漂移。
7. **区域化农田**(farmRegion.bounds + reservedPaths + expansionDirection + 候选地块比较): 正好配我们"农田 90 格冻结"战略 —— 把冻结区/ reserved 路径写成结构化字段而不是口头规矩。
8. **机器等待 = 待办由条件唤醒**(machineReady/gameTime/resource 唤醒)替代轮询; rest 支持指定目标体力(我们只在 <15 睡)。
9. **验收记录文化**: 每个功能一份 acceptance doc(实机证据+复测), 我们公开仓可以加 docs/acceptance/ 简版。

## 三、架构级参考(远期)

10. **能力自学习闭环**: 发现缺口 → 与玩家商量范围(留 permission_quote 原话) → 查原生接口 → 生成 C# → 独立进程编译 → 热加载 try → 观察 → keep/rollback → 存档复用。我们的 NagiBridgeRemix 是闭源预编译 DLL 抄不了热编译, 但**可以自己写一个 5KB SMAPI 小 mod 补它没有的口子**(如自动抚摸/批量机器)。此闭环流程本身可照搬。
11. **方法与流程分离**: 固定 day-loop.mjs 之外, 把"今天怎么干"写成可修订的自然语言方法文档(它们的 SKILL.md 就是), 现场由模型组合原语 —— 我们 3 天连续 day-loop 上限+巡检规则可逐步上移到这种文档。
12. **双路径会话延续**: 游戏内启动 vs 外部会话主动连接, 读档清执行+刷新世界但保人格/记忆映射, 有 reload_history。对我们= "游戏重启后 day-loop 续日"的正式化。

## 四、不取的部分

- MCP/WS 全双工协议+聊天栏 UI: 我们 HTTP cron 轮询够用, 引入成本高。
- 独立伙伴角色: 它不能替我们已有的"控玩家"玩法, 两种互斥。
- 矿洞战斗/完整钓鱼/跟随: 它自己也没做完(README 明说待扩展)。

## 附: 它的教训印证了我们的坑

- 它把"浇水账本重复累计""树砍倒了返回 0""部分成功重复扣料"当发布必修 —— 同类 bug 我们全踩过(两条鱼只卖一条/存箱被 openBin 吞)。
- 它强调"外部路径每轮带完整精简状态, 不依赖增量基线"(防上下文压缩后丢基线) —— 与我们 dsh 压缩地板价教训同构。
