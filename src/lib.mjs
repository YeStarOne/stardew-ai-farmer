// 星露谷 AI 自主游玩脚本库 v2 (Remix NagiBridge, localhost:7842, 必须用 localhost)
// v2 变更(2026-10-28):
//   ① 卖出白名单政策(用户拍板): 只卖 鱼+农作物+垃圾, 其余绝不卖 → 存木箱或留背包
//      (教训: 曾按黑名单 KEEP 卖掉 Deluxe Bait / Sonar Bobber)
//   ② 物理点击前台互锁: 用户可能在同一台电脑玩别的游戏, openBin/harvestCrops 前先确认
//      前台进程是 Stardew, 否则拒绝点击(fg-name.ps1)
//   ③ 通用右键收割 harvestCrops(/harvest 收不掉的作物如草莓)
//   ④ 木箱: findChest / storeToChest / craftChest / placeChestNearHouse
//   ⑤ 移植验证过的 chopWood(砍树) / tillTiles+expandField(翻地扩田)
const BASE = 'http://localhost:7842';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

export const get = async (p) => (await fetch(BASE + p)).json();
export const post = async (p, b = {}) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
})).json();
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function st() { return (await get('/state')); }
export async function surr(radius = 8) { return (await get(`/surroundings?radius=${radius}`)); }
export async function sel(name) { return post('/select', { name }); }
export async function face(dir) { return post('/face', { direction: dir }); }

// 方向: 0=上 1=右 2=下 3=左
export const faceToward = (fx, fy, tx, ty) => {
  const dx = tx - fx, dy = ty - fy;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
};

// 闭环移动：/move 偏移不可信，重读 state 校验，最多 8 次
export async function go(x, y) {
  for (let i = 0; i < 8; i++) {
    const s = await st();
    if (s.player.x === x && s.player.y === y) return true;
    await post('/move', { x, y });
    await sleep(1200);
  }
  const s = await st();
  return s.player.x === x && s.player.y === y;
}

// 站到目标四邻中第一个能站住的格
export async function standAdj(tx, ty) {
  for (const [cx, cy] of [[tx, ty + 1], [tx, ty - 1], [tx + 1, ty], [tx - 1, ty]]) {
    if (await go(cx, cy)) return { x: cx, y: cy };
  }
  return null;
}

// 对 (tx,ty) 用手持物品/工具：走过去面朝它 use，返回 tile 是否命中
export async function useOn(tx, ty) {
  const stand = await standAdj(tx, ty);
  if (!stand) return { ok: false, why: 'unreachable' };
  const c = await st();
  await face(faceToward(c.player.x, c.player.y, tx, ty));
  await sleep(120);
  const r = await post('/use', {});
  const hit = r.tile && r.tile.x === tx && r.tile.y === ty;
  return { ok: !!hit, r, stand };
}

// 传送并等待切场景完成；失败自动重试（warp 返回的 actual 是旧位置，必须轮询 location）
export async function warp(loc, x, y) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await post('/warp', { location: loc, x, y });
    for (let i = 0; i < 8; i++) {
      await sleep(1200);
      const s = await st();
      const cur = s.location?.name || s.location;
      if (cur === loc) return { loc: cur, x: s.player.x, y: s.player.y };
      if (s.activeMenu) { await post('/menu_close', {}); await sleep(400); }
    }
    log('warp未到', loc, '重试', attempt + 1);
  }
  const s = await st();
  return { loc: s.location?.name || s.location, x: s.player.x, y: s.player.y, failed: true };
}

// 浇半径内所有作物（自动 refill），返回成功数
export async function waterAll(radius = 12) {
  await sel('Watering Can');
  const sr = await surr(radius);
  // 只浇干土: watered=true 的格子保持到次日清晨, 重浇纯浪费(2026-10-29 用户指出)
  const crops = sr.tiles.filter(t => t.crop && !t.watered);
  // 蛇形逐行扫: 先按行再按列, 同行连浇少跑路(孤格停十几秒的根因=跳行走位, 2026-10-29 用户观察)
  crops.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  log(`浇水: 干土 ${crops.length}/${sr.tiles.filter(t => t.crop).length}`);
  let ok = 0;
  for (const t of crops) {
    let done = false;
    for (const [cx, cy] of [[t.x, t.y + 1], [t.x, t.y - 1], [t.x + 1, t.y], [t.x - 1, t.y]]) {
      if (await go(cx, cy)) {
        await sel('Watering Can');
        const c = await st();
        const can = c.inventory.find(i => i.name === 'Watering Can');
        if (can && can.waterLeft !== undefined && can.waterLeft <= 0) {
          log('水壶空, refill');
          await post('/refill', {});
          await sleep(800);
        }
        await face(faceToward(c.player.x, c.player.y, t.x, t.y));
        await sleep(150);
        const r = await post('/use', {});
        await sleep(250);
        done = r.tile && r.tile.x === t.x && r.tile.y === t.y;
        break;
      }
    }
    if (done) ok++;
  }
  log('浇水', ok, '/', crops.length);
  return ok;
}

// fishbot 设定到指定状态（/fishbot 是 toggle，必须校验 enabled 再决定是否补一刀）
export async function fishbotSet(on) {
  let r = await post('/fishbot', {});
  if (r.enabled !== on) {
    await sleep(300);
    r = await post('/fishbot', {});
  }
  return r.enabled;
}

// ================= 物理点击安全互锁 =================
// 用户可能在同一台电脑玩别的游戏: 任何物理鼠标点击前必须确认星露谷在前台
export async function foregroundIsStardew() {
  try {
    const name = execSync('powershell -NoProfile -ExecutionPolicy Bypass -File "D:/StardewAI/fg-name.ps1"',
      { encoding: 'utf8', timeout: 15000 }).trim();
    return /Stardew/i.test(name);
  } catch { return false; }
}

// 物理右键 (rightclick.ps1 已内置 SetProcessDPIAware, 坐标=1920x1080 逻辑像素)
export function physicalRightClick(ax, ay) {
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "D:/StardewAI/rightclick.ps1" -ax ${ax} -ay ${ay}`,
    { timeout: 30000 });
}

// ================= 卖出白名单政策 (2026-10-28 用户拍板) =================
// 原则: 只有白名单内的东西才卖; 白名单外一律 存木箱(没有箱子就留背包), 宁可停钓不可误卖
const SELL_FISH = /\b(Bass|Trout|Catfish|Chub|Perch|Carp|Sunfish|Shad|Walleye|Bream|Pike|Eel|Sardine|Anchovy|Flounder|Halibut|Octopus|Squid|Snapper|Tuna|Cucumber|Stonefish|Ghostfish|Dorado|Blobfish|Slimejack|Pufferfish|Stingray|Lionfish|Salmon|Ice Pip|Lava Eel|Sandfish)\b/;
const SELL_CROPS = /^(Parsnip|Strawberry|Cauliflower|Potato|Melon|Tomato|Blueberry|Hot Pepper|Pepper|Wheat|Corn|Eggplant|Pumpkin|Yam|Grape|Amaranth|Kale|Radish|Green Bean|Starfruit|Rhubarb|Hops|Tea Leaves|Unmilled Rice|Fiddlehead Fern|Cranberries|Sweet Gem Berry|Ancient Fruit)$/;
const SELL_TRASH = /^(Trash|Driftwood|Soggy Newspaper|Broken CD|Broken Glasses|Joja Cola)$/;
export const isSellable = n => SELL_FISH.test(n) || SELL_CROPS.test(n) || SELL_TRASH.test(n);

// 任务保留位(用户拍板"有邮件优先做任务"): 这些物品即使可卖也要留 N 件在背包
// quest 101 = 乔迪要 1 花椰菜(10-29)
export const QUEST_RESERVE = { Cauliflower: 1 };

// 常驻背包类: 既不卖也不存(工具/鱼竿/鱼饵/鱼钩/种子/待放置的箱子)
export const isCarry = n =>
  /^(Axe|Hoe|Watering Can|Pickaxe|Scythe|Bamboo Pole|Fiberglass Rod|Iridium Rod|Training Rod|Chest|.*Bobber|.*Bait|.*Tackle)$/i.test(n)
  || /Seeds$|Starter$|Shoot$/i.test(n);

// 应存箱: 不卖、也不必常驻背包的(采集物/素材/矿石/食物/多余装备)
// 注意: 采集物不卖 — 社区中心收集包(春季/夏季采集包)会用到
export const shouldStore = n => !isSellable(n) && !isCarry(n);

// ================= 背包快照工具 =================
export function invSnapshot(s) {
  const m = {};
  for (const i of s.inventory) if (i.name) m[i.name] = (m[i.name] ?? 0) + (i.stack ?? 1);
  return m;
}
// b 相对 a 的总增量
export function snapshotGain(a, b) {
  let n = 0;
  for (const k in b) if ((b[k] ?? 0) > (a[k] ?? 0)) n += b[k] - (a[k] ?? 0);
  return n;
}

// 开杂货箱（物理右键, 内含前台互锁），返回是否成功打开 ItemGrabMenu
// 杂货箱在 Farm (72,14); /store 对它无效, 只能走 UI
export async function openBin() {
  if (!(await foregroundIsStardew())) {
    log('!! 前台不是星露谷(用户可能在玩别的), 拒绝物理右键');
    return false;
  }
  await warp('Farm', 72, 15);
  // 先清掉残留对话框, 否则物理右键会落在对话框上
  for (let i = 0; i < 2; i++) {
    const s0 = await st();
    if (!s0.activeMenu) break;
    await post('/menu_close', {});
    await sleep(600);
  }
  // 注意: /click_tile 不会移动系统鼠标(它只做游戏内点击/返回坐标), 真实鼠标由
  // rightclick.ps1 定位。坐标必须用 click_tile 实时返回的 absolute(屏幕物理坐标,
  // 随窗口位置走)—— 写死标定值会因窗口挪位而点空(10-29 实测踩坑)
  const c = await post('/click_tile', { x: 72, y: 14 });
  if (!c?.absolute) { log('click_tile 拿不到杂货箱屏幕坐标'); return false; }
  physicalRightClick(c.absolute.x, c.absolute.y);
  await sleep(1500);
  let s = await st();
  if (s.activeMenu?.type !== 'ItemGrabMenu') {
    physicalRightClick(c.absolute.x, c.absolute.y);
    await sleep(1500);
    s = await st();
  }
  return s.activeMenu?.type === 'ItemGrabMenu';
}

// ================= 通用右键收割 =================
// /harvest 收不掉的作物(草莓类)逐株收: 站四邻 → click_tile 拿绝对坐标 → 物理右键 → 快照差分验证
export async function harvestCrops(maxWaves = 6, slotLimit = 11) {
  if (!(await foregroundIsStardew())) {
    log('!! 前台不是星露谷, 跳过右键收割');
    return 0;
  }
  // 手持切到种子类, 防右键触发工具动作
  const s0 = await st();
  const seedItem = s0.inventory.find(i => /Seeds$|Starter$|Shoot$/i.test(i.name));
  if (seedItem) await sel(seedItem.name);
  let total = 0;
  for (let wave = 0; wave < maxWaves; wave++) {
    const sr = await surr(14);
    const ripe = sr.tiles.filter(t => t.harvestable);
    if (!ripe.length) break;
    log('收割 wave' + wave, '成熟', ripe.length);
    let waveGain = 0;
    for (const t of ripe) {
      if ((await st()).inventory.filter(i => i.name).length >= slotLimit) {
        log('背包将满, 中断收割');
        wave = 99;
        break;
      }
      let pos = null;
      for (const [cx, cy] of [[t.x, t.y + 1], [t.x, t.y - 1], [t.x + 1, t.y], [t.x - 1, t.y]]) {
        if (await go(cx, cy)) { pos = { cx, cy }; break; }
      }
      if (!pos) { log('够不着', t.x, t.y); continue; }
      const c = await post('/click_tile', { x: t.x, y: t.y }).catch(() => null);
      if (!c?.absolute) { log('拿不到坐标', t.x, t.y); continue; }
      const before = invSnapshot(await st());
      physicalRightClick(c.absolute.x, c.absolute.y);
      await sleep(900);
      let after = invSnapshot(await st());
      let gain = snapshotGain(before, after);
      if (!gain) { // 一次没中补一发
        physicalRightClick(c.absolute.x, c.absolute.y);
        await sleep(900);
        after = invSnapshot(await st());
        gain = snapshotGain(before, after);
      }
      if (gain) { total += gain; waveGain += gain; log('摘到 @', t.x, t.y, '+', gain); }
      else log('没摘到 @', t.x, t.y);
      const s3 = await st();
      if (s3.activeMenu) { await post('/menu_close', {}); await sleep(400); }
    }
    if (!waveGain) break; // 整轮颗粒无收, 防死循环
  }
  log('== 右键收割共', total, '==');
  return total;
}

// ================= 木箱 =================
// 找附近木箱(/store 只认木箱, 杂货箱不行)
export async function findChest(radius = 18) {
  const sr = await surr(radius);
  const c = sr.tiles.find(t => /Chest/i.test(t.object || ''));
  return c ? { x: c.x, y: c.y, name: c.object } : null;
}

// 按名字存一件进木箱 (纯 HTTP, 不需要 UI)
export async function storeToChest(name, chest) {
  const r = await post('/store', { name, x: chest.x, y: chest.y });
  return !r.error;
}

// 合成木箱 (需 50 木)
// ⚠️ 10-29 血泪坑: 背包满时合成会 "item dropped" 掉地上! 合成前必须有空格
export async function craftChest() {
  const s = await st();
  if (s.inventory.filter(i => i.name).length >= 12) { log('背包满, 拒绝合成(防掉落)'); return false; }
  const r = await post('/craft', { name: 'Chest' }).catch(e => ({ error: String(e) }));
  log('craft Chest →', JSON.stringify(r).slice(0, 150));
  return !r.error;
}

// 把手上的箱子放到杂货箱(72,14)附近空地, 成功返回箱子坐标
export async function placeChestNearHouse() {
  const spots = [[71, 16], [70, 16], [73, 15], [71, 13], [73, 13], [70, 14]];
  for (const [x, y] of spots) {
    const t = (await surr(14)).tiles.find(z => z.x === x && z.y === y);
    if (!t || t.object || t.crop || t.terrain === 'HoeDirt') continue;
    const r = await useOn(x, y); // 手上需已选中 Chest
    if (r.ok) {
      const c = await findChest(18);
      if (c) { log('箱子放置成功 @', c.x, c.y); return c; }
    }
  }
  log('箱子放置失败(留在背包, 明天再放)');
  return null;
}

// ================= 砍树攒木 (chop.mjs 验证版移植) =================
export async function chopWood(target = 50, staminaFloor = 40) {
  let wood = invCount(await st(), 'Wood');
  const needed = target - wood;
  if (needed <= 0) return wood;
  const sr = await surr(14);
  const trees = sr.tiles.filter(t => /^Tree/.test(t.terrain || ''));
  log('砍树: 现有木', wood, '还差', needed, '| 附近树', trees.length);
  let chopped = 0;
  for (const t of trees) {
    if (chopped >= needed) break;
    for (let i = 0; i < 20; i++) {
      const s = await st();
      if (s.player.stamina < staminaFloor) { log('体力低停手'); return invCount(await st(), 'Wood'); }
      let ok = false;
      for (const [cx, cy] of [[t.x, t.y + 1], [t.x, t.y - 1], [t.x + 1, t.y], [t.x - 1, t.y]]) {
        if (await go(cx, cy)) { ok = true; break; }
      }
      if (!ok) break;
      await sel('Axe');
      const c = await st();
      await face(faceToward(c.player.x, c.player.y, t.x, t.y));
      await sleep(120);
      await post('/use', {});
      await sleep(250);
      const tile = (await surr(4)).tiles.find(z => z.x === t.x && z.y === t.y);
      if (!tile || !/^Tree/.test(tile.terrain || '')) {
        chopped++;
        log('砍倒 @', t.x, t.y);
        await go(t.x, t.y).catch(() => null);
        await sleep(400);
        break;
      }
    }
  }
  // 走一圈捡掉落
  for (const [x, y] of [[65, 21], [61, 20], [63, 22], [67, 20], [70, 21]]) {
    await go(x, y).catch(() => null);
    await sleep(300);
  }
  wood = invCount(await st(), 'Wood');
  log('砍树后木头:', wood);
  return wood;
}

// ================= 翻地/扩田 (till-plant.mjs 验证版移植) =================
export async function tillTiles(targets = []) {
  await sel('Hoe');
  let tilled = 0;
  for (const [x, y] of targets) {
    const t = (await surr(10)).tiles.find(z => z.x === x && z.y === y);
    if (t && t.terrain === 'HoeDirt') continue;
    if (t && t.object) { log('跳过(有物)', x, y, t.object); continue; }
    const r = await useOn(x, y);
    if (r.ok) tilled++;
    await sleep(300);
  }
  log('翻地', tilled, '/', targets.length);
  return tilled;
}

// 贴着现有田边自动扩格(种子有剩但地不够时用), 最多 maxTiles 格
export async function expandField(maxTiles = 10) {
  const sr = await surr(16);
  const dirt = sr.tiles.filter(t => t.terrain === 'HoeDirt');
  if (!dirt.length) return 0;
  const cand = [];
  for (const d of dirt) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const nx = d.x + dx, ny = d.y + dy;
      if (cand.some(c => c[0] === nx && c[1] === ny)) continue;
      const t = sr.tiles.find(z => z.x === nx && z.y === ny);
      if (!t) continue;
      if (t.terrain === 'HoeDirt' || t.object || t.crop) continue;
      if (/Water|Sea/i.test(t.terrain || '')) continue;
      cand.push([nx, ny]);
    }
  }
  if (!cand.length) return 0;
  log('扩田候选', cand.length, '格, 取', Math.min(maxTiles, cand.length));
  // ⚠️2026-10-29: 直接 /use 锄地是假ok(挥空不动), 唯一可靠锄地通路=行为学框选(3x2实测6/6, 58格全成)
  const pick = cand.slice(0, maxTiles);
  try {
    const bx = pick.map(p => p[0]), by = pick.map(p => p[1]);
    await sel('Hoe');
    const r = await behaviorSelect(Math.min(...bx), Math.min(...by), Math.max(...bx), Math.max(...by), 'left');
    if (r.ok && r.added > 0) {
      await behaviorWaitDone(5 * 60 * 1000);
      const after = await surr(16);
      const tilled = pick.filter(([x, y]) => after.tiles.some(t => t.x === x && t.y === y && t.terrain === 'HoeDirt')).length;
      log('行为学翻地', tilled, '/', pick.length);
      return tilled;
    }
  } catch (e) { log('行为学不可用, 回退直接锄:', String(e).slice(0, 60)); }
  return tillTiles(pick);
}

// ================= 基础工具 =================
// 截图存盘: await shot('D:/StardewAI/shot.png')
export async function shot(path = 'D:/StardewAI/shot.png') {
  const r = await post('/screenshot', {});
  if (r.image) { fs.writeFileSync(path, Buffer.from(r.image, 'base64')); return true; }
  return false;
}

// 背包里找物品数量
export function invCount(s, name) {
  const it = s.inventory.find(i => i.name === name);
  return it ? (it.stack ?? 1) : 0;
}

// 日志工具
export const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

// ================= 行为学桥接 (BehaviorAutomation+BehaviorBridge, localhost:7845) =================
// 框选区域自动作业(自动寻路+智能换工具+蓄力浇水+动物照料), 替代物理拖框
// ⚠️ ①行为学只在游戏窗口前台时推进作业(源码 Tick 传 Game1.game1.IsActive)
//    ②作业期间不要再发 /move(双方抢角色), 等 behaviorWaitDone 回来再动
//    ③2026-10-29 装, 尚未实机验证 —— 首次使用先 GET /status 确认 behaviorLoaded
const BB = 'http://localhost:7845';
const bbGet = async (p) => (await fetch(BB + p)).json();
const bbPost = async (p, b = {}) => (await fetch(BB + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b)
})).json();

// 框选并开工: button 默认 'right'(智能换工具池, 自动选斧/镐/锄/镰), 'left'=手持道具/种子/材料
// 返回 {ok,added,removed,mode,smart,state}: added=这次框选生成的任务数
export const behaviorSelect = (x1, y1, x2, y2, button = 'right') => bbPost('/select', { x1, y1, x2, y2, button });
export const behaviorStatus = () => bbGet('/status');
export const behaviorClear = () => bbPost('/clear', {});
export const behaviorPause = () => bbPost('/pause', {});
export const behaviorResume = () => bbPost('/resume', {});
export const behaviorActions = () => bbGet('/actions');
export const behaviorSetAction = (scope, kind, enable) => bbPost('/actions', { scope, kind, enable });

// 等行为学把选区做完(轮询 status), 超时返回最后状态
export async function behaviorWaitDone(timeoutMs = 10 * 60 * 1000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(5000);
    try { s = await behaviorStatus(); } catch { continue; }
    if (!s.hasSession || (!s.active && s.jobs === 0)) break;
  }
  return s;
}

// ================= 白名单清仓(随时可调, day-loop 与手动共用) =================
// 卖 isSellable(鱼+农作物+垃圾) → 其余 shouldStore 存木箱(纯 HTTP); force=true 不看格数直接清
export async function sellAndStore(chest, force = false) {
  let s = await st();
  const items = s.inventory.filter(i => i.name);
  const slots = items.length;
  // 任务保留: 名单内物品绝对不卖(整叠保护, 10-29 曾把乔迪的花椰菜整叠卖掉)
  const sellables = items.filter(i => isSellable(i.name) && !QUEST_RESERVE[i.name]);
  const storables = items.filter(i => shouldStore(i.name));
  if (!force && slots < 10) return 0;
  if (!sellables.length && !(chest && storables.length)) { log('背包' + slots + '/12 无可卖无箱可存, 跳过'); return 0; }
  log('背包', slots + '/12 → 清仓 | 卖:', sellables.map(i => i.name + 'x' + (i.stack ?? 1)).join(',') || '无',
    '| 存箱:', storables.map(i => i.name).join(',') || '无');
  const opened = await openBin(); // 内含前台互锁
  if (!opened) { log('杂货箱没开成(前台被占/残留菜单), 稍后再试'); return 0; }
  let sold = 0;
  for (let round = 0; round < 25; round++) {
    s = await st();
    if (s.activeMenu?.type !== 'ItemGrabMenu') break;
    const item = s.inventory.find(i => i.name && isSellable(i.name));
    if (!item) break;
    // 必须用 item 自己的 slotIndex(inventory 数组会跳过空格, 数组下标≠格子)
    const idx = item.slotIndex ?? s.inventory.findIndex(i => i.name === item.name);
    const x = 265 + (idx % 12) * 65, y = idx < 12 ? 478 : 545;
    await post('/menu/click', { x, y }).catch(() => null);
    await sleep(800);
    s = await st();
    if (!s.inventory.some(z => z.name === item.name)) { sold++; log('投放', item.name); }
    else { log('投放失败', item.name); break; }
    if (s.activeMenu?.type !== 'ItemGrabMenu') break;
  }
  await post('/menu_close', {}); await sleep(500);
  await post('/menu_close', {}); await sleep(300);
  // 存箱(纯 HTTP, 不需要 UI; /store 只认木箱)
  let stored = 0;
  if (chest) {
    // 箱子不在当前地图就先走过去(/store 可能查距离)
    const cur = await st();
    const curLoc = cur.location?.name || cur.location;
    if (chest.loc && curLoc !== chest.loc) {
      await warp(chest.loc, chest.x, chest.y + 1);
      await sleep(600);
    }
    for (let round = 0; round < 12; round++) {
      s = await st();
      const it = s.inventory.find(i => i.name && shouldStore(i.name));
      if (!it) break;
      if (await storeToChest(it.name, chest)) { stored++; log('存箱', it.name); await sleep(400); }
      else { log('存箱失败', it.name, '→ 下轮再试'); break; }
    }
  }
  s = await st();
  log('清仓', sold, '件 存箱', stored, '件 | 钱', s.player.money, '| 格子', s.inventory.filter(i => i.name).length + '/12');
  return sold;
}
