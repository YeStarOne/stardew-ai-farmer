// 夜间守卫: 每天凌晨 0:30 前强制睡觉, 防止"路边睡着"
// 长驻运行: node night-guard.mjs
import { st, log, post, sleep, warp, fishbotSet } from './lib.mjs';

log('夜间守卫启动 (触发线: 游戏时间 2430 = 凌晨00:30)');
let lastDay = -1;
let lastReport = '';
while (true) {
  await sleep(15000);
  let s;
  try { s = await st(); } catch { continue; } // 游戏不在/请求炸了, 下轮再试
  if (!s?.time?.timeOfDay) continue;          // 世界未就绪时 /state 返回错误对象而非抛异常
  const t = s.time.timeOfDay;
  const day = s.time.dayOfMonth;
  if (day !== lastDay) {
    log('== Day' + day, '==');
    lastDay = day;
  }
  const report = s.player.x + ',' + s.player.y + '@' + (s.location?.name || s.location) + ' t=' + t;
  if (report !== lastReport && t >= 2400) { log(report); lastReport = report; }

  // 触发线1: 凌晨 2430 (00:30); 触发线2: 体力条见底 (<=40) → 直接睡觉回体力
  const staminaLow = s.player.stamina <= 10;
  if (t >= 2430 || staminaLow) {
    if (staminaLow && t < 2400) log('!!! 体力耗尽', Math.round(s.player.stamina), '→ 防晕倒强制睡觉');
    log('!!! 触发守卫: 时间', t, '→ 强制睡觉流程');
    await fishbotSet(false);
    // 关掉任何菜单
    for (let i = 0; i < 3; i++) {
      const s2 = await st();
      if (!s2.activeMenu) break;
      await post('/menu_close', {});
      await sleep(500);
    }
    // 回家
    const w = await warp('FarmHouse', 9, 9);
    log('回家:', JSON.stringify(w));
    // 睡觉 (重试 3 轮)
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await post('/sleep', {});
      log('sleep:', JSON.stringify(r).slice(0, 150));
      // 等换天
      for (let i = 0; i < 10; i++) {
        await sleep(4000);
        const s2 = await st();
        if (s2.time.dayOfMonth > day) {
          log('✓ 已换天 Day' + s2.time.dayOfMonth, '钱', s2.player.money, '体力', s2.player.stamina);
          break;
        }
      }
      const s3 = await st();
      if (s3.time.dayOfMonth > day) break;
      // 没睡成: 可能人不在床上/位置漂移, 重走流程
      log('没睡成, 重试', attempt + 1);
      await warp('FarmHouse', 9, 9);
    }
  }
}
