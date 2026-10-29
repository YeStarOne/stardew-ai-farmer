// 通用: 指定行列批量翻地+播种 (seedName)
import { st, surr, sel, useOn, log, invCount, sleep } from './lib.mjs';

const seedName = process.argv[2] || 'Parsnip Seeds';
const targets = process.argv[3]
  ? JSON.parse(process.argv[3])
  : [[61, 21], [62, 21], [63, 21], [64, 21], [65, 21], [66, 21], [67, 21]];

await sel('Hoe');
let tilled = 0;
for (const [x, y] of targets) {
  const sr = await surr(8);
  const t = sr.tiles.find(t => t.x === x && t.y === y);
  if (t && t.terrain === 'HoeDirt') continue;
  if (t && t.object) { log('跳过', x, y, t.object); continue; }
  const r = await useOn(x, y);
  if (r.ok) tilled++;
  log('锄', x, y, r.ok ? 'OK' : (r.why || 'MISS'));
  await sleep(300);
}
log('翻地', tilled);

await sel(seedName);
let planted = 0;
for (const [x, y] of targets) {
  const sr = await surr(8);
  const t = sr.tiles.find(t => t.x === x && t.y === y);
  if (!t || t.terrain !== 'HoeDirt' || t.crop) continue;
  const r = await useOn(x, y);
  if (r.ok) planted++;
  log('种', x, y, r.ok ? 'OK' : (r.why || 'MISS'));
  await sleep(300);
}
const s = await st();
log('完成: 翻' + tilled + ' 种' + planted, '剩', invCount(s, seedName), '体力', s.player.stamina, '时间', s.time.timeOfDay);
