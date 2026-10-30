# 验收: star 项目一/二部分落地 (2026-10-30)

> 借鉴 github.com/CSXizhang/star (调研笔记: docs/research/star-project-study.md) 一(立即可取)与二(低成本可取)共 9 项。

## 落地清单

| # | star 功能 | 我们的实现 | 验证 |
|---|---|---|---|
| 1 | 双源 wiki 查询(TTL缓存) | `src/bwiki.mjs` (BWIKI MediaWiki API, 7890代理, 7天缓存; 英维 Cloudflare 全挡故弃) | ✅ 实机: search/page 实抓"骷髅洞穴"页 14231 字 |
| 2 | 行动日志+结果对账 | lib.mjs 包 post → `action-journal.jsonl` 每个副作用动作落 {t,id,endpoint,body,result}; `readJournal(n)` | ✅ 语法+单测; 游戏动作时自动生效 |
| 3 | 回执铁律 | 4条写入 D:/DeepseekHarness/docs/游戏-AI游玩方案.md §十九 | ✅ 文档化 |
| 4 | 累计账本 vs 有界预览 | `ledger.json` + `ledInc/ledSnapshot` (totals 只增, recent 封顶20); day-loop 日结 daysPlayed/moneyEarned; sellAndStore 入 itemsSold/itemsStored | ✅ 单测(测试数据已清) |
| 5 | 增量世界快照 | `compactState` 一行日志 + `stateDelta` 差分(本轮先做基元, 轮询全面切换待下一版) | ✅ 单测: 差分正确报 money/stamina/menu |
| 6 | save级结构化记忆 | `memory-save.json` + memAdd/memCorrect/memRevoke/memList; superseded 链不删原文; event 封顶60; day-loop 开工印 rule/日结写 event | ✅ 单测: 修订/撤销链正确 |
| 7 | 区域化农田配置 | `farm-region.json` + `regionConfig()`; policy=冻结 时 day-loop 扩田直接跳过(90格冻结从口头规矩变代码门控) | ✅ 单测: 默认文件自动生成 |
| 8 | rest 目标 / 条件唤醒 | 收工体力收口 `REST_TARGET=15` 常量; 机器唤醒暂缓(尚无机器) | ✅ 常量化 |
| 9 | 验收记录文化 | 本文件即首篇 | ✅ |

## 不落地
- #10-12 (架构级: C#热编译自学习/方法与流程分离/双路径会话): 远期, 见 star-project-study.md 三。
