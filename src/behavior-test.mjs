// 行为学桥接验证脚本(游戏启动后跑): node behavior-test.mjs
// ①确认桥接挂接 ②看行为配置 ③框选玩家脚下 3x3 试跑一轮
import { behaviorStatus, behaviorActions, behaviorSelect, behaviorWaitDone, st, log } from './lib.mjs';

let s;
try { s = await behaviorStatus(); }
catch { console.log('!! 7845 无响应: 游戏没开 / BehaviorBridge 没装好'); process.exit(1); }
log('status:', JSON.stringify(s));
if (s.state === undefined) { console.log('!! /status 响应异常'); process.exit(1); }

const acts = await behaviorActions();
log('行为配置: held=' + acts.held.length, 'leftExtra=' + acts.leftExtra.length, 'smart=' + acts.smart.length);
log('smart 池:', acts.smart.join(','));

const p = (await st()).player;
log('玩家在', p.x, p.y, '→ 框选 3x3 试跑');
const r = await behaviorSelect(p.x - 1, p.y - 1, p.x + 1, p.y + 1, 'right');
log('select 返回:', JSON.stringify(r));

const done = await behaviorWaitDone(3 * 60 * 1000);
log('完成后 status:', JSON.stringify(done));
