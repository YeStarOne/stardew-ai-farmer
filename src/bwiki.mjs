// BWIKI 星露谷中文百科查询工具 (star 项目 wiki.py 借鉴, 2026-10-30)
// 背景: stardewvalleywiki.com 被 Cloudflare 全挡(WebFetch/代理/UA 都 403),
//       BWIKI MediaWiki API 实测 200 通 —— 数据源切到这条。
// 用法:
//   node bwiki.mjs search 骷髅洞穴      → 搜页面标题
//   node bwiki.mjs page 骷髅洞穴        → 拉页面 wikitext(截前 6000 字)
//   node bwiki.mjs raw <api参数串>      → 直接调 api.php(高级用法)
// 缓存: D:/StardewAI/.bwiki-cache.json, TTL 7 天(star 同款)
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const API = 'https://wiki.biligame.com/stardewvalley/api.php';
const CACHE_PATH = 'D:/StardewAI/.bwiki-cache.json';
const TTL = 7 * 24 * 3600 * 1000;

function cacheGet(key) {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    const e = c[key];
    if (e && Date.now() - e.t < TTL) return e.v;
  } catch { }
  return null;
}
function cachePut(key, v) {
  try {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch { }
    const keys = Object.keys(c);
    if (keys.length > 200) delete c[keys[0]]; // 粗略防膨胀
    c[key] = { t: Date.now(), v };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(c));
  } catch { }
}

function api(params) {
  const url = `${API}?${params}&format=json&formatversion=2`;
  const hit = cacheGet(url);
  if (hit) return hit;
  // 必须走 7890 代理(本机实测; 直连被墙/污染), maxBuffer 放大防长页面截断
  const out = execSync(`curl -s --max-time 40 -x http://127.0.0.1:7890 "${url}"`,
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let v;
  try { v = JSON.parse(out); } catch { v = { raw: out.slice(0, 500) }; }
  cachePut(url, v);
  return v;
}

const [cmd, ...rest] = process.argv.slice(2);
const q = rest.join(' ');

if (cmd === 'search') {
  if (!q) { console.log('用法: node bwiki.mjs search <关键词>'); process.exit(1); }
  const r = api(`action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=10`);
  for (const s of (r.query?.search ?? [])) console.log(s.title, '|', (s.snippet || '').replace(/<[^>]+>/g, ''));
} else if (cmd === 'page') {
  if (!q) { console.log('用法: node bwiki.mjs page <页面标题(先用 search 找)>'); process.exit(1); }
  const r = api(`action=parse&page=${encodeURIComponent(q)}&prop=wikitext`);
  const w = r.parse?.wikitext;
  if (!w) { console.log('没拉到:', JSON.stringify(r).slice(0, 300)); process.exit(1); }
  console.log(`===== ${q} wikitext(${w.length} 字, 截前 6000) =====`);
  console.log(w.slice(0, 6000));
} else if (cmd === 'raw') {
  console.log(JSON.stringify(api(q.startsWith('action=') ? q : 'action=' + q), null, 1).slice(0, 8000));
} else {
  console.log('用法: node bwiki.mjs search|page|raw <参数>');
}
