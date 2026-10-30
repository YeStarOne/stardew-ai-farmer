// 全自主日循环 v3 (2026-10-28)
// 政策(用户拍板): 只卖 鱼+农作物+垃圾(lib.isSellable 白名单); 其余存木箱/留背包 绝不卖
//                 体力用到 <15 才收工(用完再睡不浪费); 物理点击有前台互锁(用户可能玩别的游戏)
// 流程/天: 一键收+右键补收 → 信箱 → 浇水 → 通用补种 → 扩田 → 攒木做箱 → 白名单卖货/存箱
//          → 海滩钓鱼(fishbot) → 23:00 或体力<15 收工 → 尾清仓 → 回家睡觉
// 一次运行最多连玩 3 天; 锁文件防并发(cron 每15分钟会再拉起, 靠锁避免双实例打架)
import fs from 'node:fs';
import {
  st, warp, sel, useOn, waterAll, log, invCount, sleep, post, get, surr,
  fishbotSet, openBin, foregroundIsStardew,
  isSellable, shouldStore, harvestCrops, sellAndStore,
  findChest, storeToChest, craftChest, placeChestNearHouse,
  chopWood, expandField,
  compactState, ledInc, ledSnapshot, memAdd, memList, regionConfig
} from './lib.mjs';

// 收工体力目标(star rest 借鉴: 阈值收口成常量, 调整不用翻流程) — 政策仍是"用完再睡不浪费"
const REST_TARGET = 15;

// ===== 锁文件: 防止 cron 重复拉起多实例 =====
const LOCK = 'D:/StardewAI/.day-loop.lock';
try {
  const age = Date.now() - fs.statSync(LOCK).mtimeMs;
  if (age < 10 * 60 * 1000) {
    console.log('已有 day-loop 实例在跑(锁龄', Math.round(age / 1000), 's), 退出');
    process.exit(0);
  }
} catch { /* 无锁, 继续 */ }
fs.writeFileSync(LOCK, process.pid + ' ' + new Date().toISOString());
const heartbeat = setInterval(() => { try { fs.utimesSync(LOCK, new Date(), new Date()); } catch { } }, 60000);
process.on('exit', () => { try { fs.unlinkSync(LOCK); } catch { } });

const SEED_RE = /Seeds$|Starter$|Shoot$/i;

async function checkMail() {
  // 查信箱: 对 (68,16) 互动, 有信逐封关掉(自动接任务)
  log('查信箱...');
  await warp('Farm', 67, 16);
  await post('/face', { direction: 1 });
  await sleep(150);
  const mail0 = await get('/mail').catch(() => null);
  if (!mail0?.has_mail) { log('无信件'); return; }
  log('有信:', (mail0.unread || []).map(u => u.title).join(', '));
  await post('/interact', {});
  await sleep(1200);
  // 逐封关闭 (LetterViewerMenu: 关一封弹下一封)
  for (let i = 0; i < 8; i++) {
    const s = await st();
    if (s.activeMenu?.type !== 'LetterViewerMenu') break;
    const m = await get('/menu').catch(() => null);
    log('读信:', m?.letterTitle || '(无标题)');
    await post('/menu_close', {});
    await sleep(900);
  }
  const s = await st();
  if (s.activeMenu) { await post('/menu_close', {}); await sleep(400); }
  log('信件处理完');
}

// 白名单清仓(实现已抽到 lib.sellAndStore, 手动/巡检也能随时调)
async function manageInventory(chest, force = false) {
  const s = await st();
  if (!force && s.inventory.filter(i => i.name).length < 10) return 0;
  log('fishbot OFF =', await fishbotSet(false));
  return sellAndStore(chest, force);
}

// 补种: 背包里所有种子通用, 种到空翻地
async function replantAll() {
  for (;;) {
    const s = await st();
    const seed = s.inventory.find(i => SEED_RE.test(i.name) && (i.stack ?? 1) > 0);
    if (!seed) break;
    await sel(seed.name);
    const cur = (await surr(14)).tiles.filter(t => t.terrain === 'HoeDirt' && !t.crop && !t.object);
    if (!cur.length) break;
    let planted = 0;
    for (const t of cur.slice(0, seed.stack ?? 1)) {
      const r = await useOn(t.x, t.y);
      if (r.ok) planted++;
      await sleep(220);
    }
    log('种', seed.name, planted, '株');
    if (!planted) break;
  }
}

// ===== 邮件任务(用户拍板: 有邮件优先做任务) =====
// quest 101 = 乔迪要花椰菜(/gift 交付, NPC 必须在当前地图)
// 排程经验(10-29): 乔迪早晨 8-11 点在家(JoshHouse), 下午会出门 → tryQuests 在清晨跑正好
async function tryQuests() {
  let s = await st();
  if (!(s.inventory.find(i => i.name === 'Cauliflower'))) return;
  log('任务: 有花椰菜 → 送给乔迪(先试她家, 再试镇上)');
  await post('/warp_into', { location: 'JoshHouse' });
  await sleep(2500);
  let r = await post('/gift', { target: 'Jodi', item: 'Cauliflower' }).catch(() => null);
  log('gift Jodi@home →', JSON.stringify(r).slice(0, 100));
  if (!r?.ok) {
    const w = await warp('Town', 50, 57);
    if (!w.failed) {
      r = await post('/gift', { target: 'Jodi', item: 'Cauliflower' }).catch(() => null);
      log('gift Jodi@Town →', JSON.stringify(r).slice(0, 100));
    }
  }
}

// ===== 单日流程 =====
async function playOneDay(day) {
  // 0. 先找木箱(农场→农舍都扫) + 清晨满包先清仓(带上箱子可存非卖品)
  let chest = await findChest(18);
  if (chest) chest.loc = (await st()).location?.name || 'Farm'; // 箱子可能扫在任意地图, 按实际位置记
  if (!chest) {
    await warp('FarmHouse', 9, 10);
    chest = await findChest(10);
    if (chest) chest.loc = 'FarmHouse';
  }
  log('木箱:', chest ? JSON.stringify(chest) : '暂无');
  {
    const s0 = await st();
    if (s0.inventory.filter(i => i.name).length >= 10) {
      log('清晨满包, 先清仓再干活');
      await manageInventory(chest);
    }
  }
  // 0.5 无箱则做箱(合成自带防掉落闸; 砍树回农场)
  if (!chest) {
    let s = await st();
    if (invCount(s, 'Wood') < 50 && s.player.stamina > 60) {
      await warp('Farm', 65, 21);
      await chopWood(50, 40);
    }
    s = await st();
    if (invCount(s, 'Wood') >= 50) {
      await craftChest();
      s = await st();
      if (s.inventory.some(i => i.name === 'Chest')) {
        await sel('Chest');
        chest = await placeChestNearHouse();
        if (chest) chest.loc = 'Farm';
      } else {
        chest = await findChest(18);
        if (chest) chest.loc = 'Farm';
      }
    } else {
      log('木头', invCount(s, 'Wood') + '/50, 继续攒');
    }
  }
  // 1. 农活
  log(JSON.stringify(await warp('Farm', 65, 21)));
  {
    const h = await post('/harvest', {}).catch(() => null);
    if (h?.harvested) log('一键收获', h.harvested, '株');
  }
  await harvestCrops(6); // /harvest 收不掉的(草莓类)逐株右键(有前台互锁)
  await checkMail();
  await waterAll(14);
  await replantAll();
  await waterAll(14); // 新种的苗当天也要浇到(补一轮)
  await tryQuests(); // 邮件任务优先于杂务(有可交付物品时)

  // 扩田: 种子还有剩但没地 → 贴着田边翻新格再种; ⚠️受 farm-region.json 区域门控(star 借鉴,
  // 冻结策略不再靠口头规矩而是读配置), M1 完成前 policy=冻结 一律不扩
  {
    const s = await st();
    const seedsLeft = s.inventory.filter(i => SEED_RE.test(i.name)).reduce((a, i) => a + (i.stack ?? 1), 0);
    const region = regionConfig();
    if (seedsLeft > 0 && (region.policy === '冻结' || region.expansionDirection === null)) {
      log(`扩田跳过: 区域策略=${region.policy}(${region.note})`);
    } else if (seedsLeft > 0) {
      const tilled = await expandField(Math.min(seedsLeft, 10));
      if (tilled > 0) await replantAll();
    }
  }

  // 3. 钓鱼 (体力<15 收工 = 用完再睡不浪费; 背包>=10 清仓)
  const bw = await warp('Beach', 44, 35);
  if (!bw.failed) {
    await sel('Bamboo Pole');
    await post('/face', { direction: 1 });
    await sleep(300);
    log('fishbot ON =', await fishbotSet(true));
    let lastReport = '';
    for (;;) {
      await sleep(20000);
      let s = await st();
      if (s.activeMenu && !/BobberBar/i.test(s.activeMenu.type)) {
        if (s.activeMenu.type === 'ItemGrabMenu') {
          const before = s.inventory.length;
          await post('/menu/click', { x: 265, y: 160 }).catch(() => null); // 宝箱先捡
          await sleep(800);
          const s2 = await st();
          if (s2.inventory.length > before) log('宝箱捡到:', s2.inventory[s2.inventory.length - 1]?.name);
          s = s2;
        }
        log('弹菜单', s.activeMenu.type, '→ 关');
        await post('/menu_close', {});
        await sleep(500);
        await post('/menu_close', {});
        await sleep(300);
        s = await st();
      }
      const report = s.inventory.map(i => i.name + 'x' + (i.stack ?? 1)).join(',');
      if (report !== lastReport) {
        log('时间', s.time.timeOfDay, '体力', Math.round(s.player.stamina), '|', report);
        lastReport = report;
      }
      const slots = s.inventory.filter(i => i.name).length;
      if (slots >= 11) {
        await manageInventory(chest);
        const s3 = await st();
        const slots3 = s3.inventory.filter(i => i.name).length;
        if (slots3 >= 11) {
          log('背包', slots3 + '/12 清不动(前台被占/没箱子), 提前收工防丢鱼');
          break;
        }
        const bw2 = await warp('Beach', 44, 35);
        if (!bw2.failed) {
          await sel('Bamboo Pole');
          await post('/face', { direction: 1 });
          await sleep(300);
          log('fishbot ON =', await fishbotSet(true));
        }
      }
      if (s.time.timeOfDay >= 2300 || s.player.stamina < REST_TARGET) {
        log('收工: 时间', s.time.timeOfDay, '体力', Math.round(s.player.stamina));
        break;
      }
    }
  }

  // 4. 尾清仓 + 睡觉(重试 3 轮)
  log('fishbot OFF =', await fishbotSet(false));
  await manageInventory(chest, true);
  for (let attempt = 0; attempt < 3; attempt++) {
    log(JSON.stringify(await warp('FarmHouse', 9, 9)));
    const r = await post('/sleep', {}).catch(e => ({ error: String(e) }));
    log('sleep:', JSON.stringify(r).slice(0, 150));
    for (let i = 0; i < 12; i++) {
      await sleep(4000);
      const s = await st();
      if (s.time.dayOfMonth > day) {
        log('✓ 换天 Day' + s.time.dayOfMonth, '钱', s.player.money, '体力', Math.round(s.player.stamina));
        return s;
      }
    }
    log('没睡成, 重试', attempt + 1);
  }
  return null;
}

// ===== 主流程 =====
let s0;
try { s0 = await st(); } catch { console.log('游戏没在跑, 退出'); process.exit(0); }
log('== Day' + s0.time.dayOfMonth, s0.time.timeOfDay, '钱', s0.player.money, '| 前台是星露谷?', await foregroundIsStardew());

const MAX_DAYS = 3;
let day = s0.time.dayOfMonth;
let curState = s0;
{
  const rules = memList('rule');
  if (rules.length) log('记忆规矩:', rules.map(r => r.text).join(' / '));
  log('累计账本:', JSON.stringify(ledSnapshot().totals));
}
for (let d = 0; d < MAX_DAYS; d++) {
  try {
    const money0 = curState.player.money;
    const next = await playOneDay(day);
    if (!next) { log('睡觉失败, 退出'); break; }
    // 日结(star 累计账本借鉴): 净额含花费, 只作参考; 卖/存件数由 sellAndStore 内部入账
    const gain = next.player.money - money0;
    ledInc('daysPlayed', 1, 'Day' + day);
    ledInc('moneyEarned', gain, 'Day' + day + ' 净' + gain + 'g');
    memAdd('event', `Day${day}: 钱${next.player.money}(净${gain}g) 体${Math.round(next.player.stamina)} ${next.location?.name || ''}`);
    log('日结 Day' + day, '净', gain + 'g | 账本', JSON.stringify(ledSnapshot().totals));
    curState = next;
    day = next.time.dayOfMonth;
    log('=== 进入 Day' + day + ' ===', compactState(next));
  } catch (e) {
    log('当日流程异常:', e.message);
    try { await fishbotSet(false); } catch { }
    await sleep(5000);
  }
}
log('day-loop 结束');
clearInterval(heartbeat);
