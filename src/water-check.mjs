// 浇水检查器: 报告半径内 干土/已浇 状况 (不动手, 只诊断)
// 用法: node water-check.mjs [radius=14]
import { st, surr, log } from './lib.mjs';

const radius = parseInt(process.argv[2]) || 14;
const sr = await surr(radius);
const crops = sr.tiles.filter(t => t.crop);
const dry = crops.filter(t => !t.watered);
const wet = crops.filter(t => t.watered);
log(`半径${radius}: 作物 ${crops.length} | 已浇 ${wet.length} | 干土 ${dry.length}`);
if (dry.length) log('干土坐标:', dry.map(t => `(${t.x},${t.y})${t.cropName || ''}`).join(' '));
const s = await st();
log('时间', s.time.season, s.time.dayOfMonth, s.time.timeOfDay, '| 体力', Math.round(s.player.stamina));
