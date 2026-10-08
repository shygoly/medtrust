// 跨院去重的发病率与罕见病登记 —— 平台签名的 Wasm 算法模块。
//
// 模块做三件事，全部在**节点内**、只对宿主写入线性内存的**数字列**做：
//   1. 按（层, 主体）把多院观察期做**区间并集**（重叠不重复计人日；相邻段按开关合并）；
//   2. 按（层, 主体, 事件键）把跨院重复记录的事件**去重**计数；
//   3. 按（层, 主体）对罕见病**按人去重**计数（同一人在同一层只算 1 例）。
// 主体键文本、日期文本、编码文本一律留在宿主 —— 因此 ABI 对「假名怎么对齐」中立。
//
// 宿主契约（**必须**满足，否则模块返回 6 拒绝）：
//   - 观察列按 (stratum, subject, startDay) **非降序**；
//   - 事件列按 (stratum, subject, eventKey) **非降序**（eventKey 由宿主把 `(编码, 日期)` 映射为编号）；
//   - 罕见病列按 (stratum, subject) **非降序**，且同一（层, 主体）在宿主侧已归并为一条（取最早诊断日）。
//   排序由宿主完成（节点侧编码），模块只做**线性扫描**：不排序、不分配堆、不导入任何函数。
//
// ABI v1（小端；宿主必须显式声明 `dedup-incidence@1`，模块自述不作数）：
//   run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32   (0 = 成功)
//   头部 @inOff（4 × i32）：
//     [nObs][nEvents][nRare][mergeAdjacent]     // n MUST = nObs + nEvents + nRare
//   列（顺序与对齐固定，宿主与测试按同一算法计算偏移）：
//     subjectObs: u32[nObs] · stratumObs: u8[nObs] · align4
//     startDay:  i32[nObs] · endDay:     i32[nObs]
//     subjectEv: u32[nEvents] · stratumEv: u8[nEvents] · align4
//     eventKey:  u32[nEvents]
//     subjectRare: u32[nRare] · stratumRare: u8[nRare]
//   输出 @outOff：
//     k × [uniqueSubjects, personDaysUnion, eventsDeduped, rareCases] (u32)
//
// 返回码：0 成功；3 分层编号越界；5 参数非法（计数为负/与 n 不符/start > end/mergeAdjacent ∉ {0,1}）；
//         6 排序契约被破坏（未按上文非降序排列 —— 宁可拒绝，也不给出悄悄算错的结果）。
//
// 零能力：只导入 env.memory（宿主创建、有上限），不导入任何函数/表/全局量，不调用 WASI，不分配堆。
//
// 语义必须与 TS 参考实现 `src/dedup-incidence-model.ts#dedupIncidenceCount` 逐字段一致；
// 两者用同一组夹具对拍（`scripts/dedup-incidence-parity.test.mjs`），漂移即测试红。

/** ABI 版本（导出为 wasm 全局常量，宿主实例化前校验）。 */
export const abi_version: i32 = 1;

const HEADER: i32 = 16;
/** 每层格数：uniqueSubjects / personDaysUnion / eventsDeduped / rareCases。 */
const CELLS: i32 = 4;
const STRIDE: i32 = 16;

function align4(off: i32): i32 {
  return (off + 3) & ~3;
}

function bump(addr: i32, delta: u32): void {
  store<u32>(addr, load<u32>(addr) + delta);
}

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (inOff < 0 || outOff <= inOff || n < 0 || k < 1) return 5;
  const nObs = load<i32>(inOff);
  const nEvents = load<i32>(inOff + 4);
  const nRare = load<i32>(inOff + 8);
  const mergeAdjacent = load<i32>(inOff + 12);
  if (nObs < 0 || nEvents < 0 || nRare < 0) return 5;
  if (nObs + nEvents + nRare !== n) return 5;
  if (mergeAdjacent !== 0 && mergeAdjacent !== 1) return 5;

  // 列偏移（与宿主 / 测试侧同一算法）
  let off = inOff + HEADER;
  const subjectObsOff = off;
  off += nObs * 4;
  const stratumObsOff = off;
  off += nObs;
  off = align4(off);
  const startDayOff = off;
  off += nObs * 4;
  const endDayOff = off;
  off += nObs * 4;
  const subjectEvOff = off;
  off += nEvents * 4;
  const stratumEvOff = off;
  off += nEvents;
  off = align4(off);
  const eventKeyOff = off;
  off += nEvents * 4;
  const subjectRareOff = off;
  off += nRare * 4;
  const stratumRareOff = off;
  off += nRare;

  for (let s = 0; s < k; s++) {
    for (let c = 0; c < CELLS; c++) store<u32>(outOff + s * STRIDE + c * 4, 0);
  }

  // ---- 观察期：区间并集（每个（层,主体）run 计 1 个去重主体）----
  let curS = -1;
  let curSubj: u32 = 0;
  let curStart = 0;
  let curEnd = 0;
  let hasRun = false;
  // 合并判据：mergeAdjacent=1 → 允许填补 1 天边界空隙（start ≤ curEnd + 2，即空隙 ≤ 1 天）；
  //           mergeAdjacent=0 → 只并重叠/紧邻段（start ≤ curEnd + 1），保留 1 天空隙。
  const gap = mergeAdjacent === 1 ? 2 : 1;

  for (let i = 0; i < nObs; i++) {
    const s = <i32>load<u8>(stratumObsOff + i);
    if (s >= k) return 3;
    const subj = load<u32>(subjectObsOff + i * 4);
    const start = load<i32>(startDayOff + i * 4);
    const end = load<i32>(endDayOff + i * 4);
    if (start > end) return 5;

    if (hasRun) {
      if (s < curS) return 6;
      if (s === curS && subj < curSubj) return 6;
      if (s === curS && subj === curSubj && start < curStart) return 6;
    }

    if (!hasRun || s !== curS || subj !== curSubj) {
      if (hasRun) bump(outOff + curS * STRIDE + 4, <u32>(curEnd - curStart + 1));
      bump(outOff + s * STRIDE, 1); // 新的（层,主体）run = 一个去重主体
      curS = s;
      curSubj = subj;
      curStart = start;
      curEnd = end;
      hasRun = true;
    } else if (start <= curEnd + gap) {
      if (end > curEnd) curEnd = end; // 重叠或相邻：并入当前段
    } else {
      bump(outOff + curS * STRIDE + 4, <u32>(curEnd - curStart + 1));
      curStart = start;
      curEnd = end;
    }
  }
  if (hasRun) bump(outOff + curS * STRIDE + 4, <u32>(curEnd - curStart + 1));

  // ---- 事件：按（层,主体,事件键）去重 ----
  let evS = -1;
  let evSubj: u32 = 0;
  let evKey: u32 = 0;
  let evHas = false;
  for (let i = 0; i < nEvents; i++) {
    const s = <i32>load<u8>(stratumEvOff + i);
    if (s >= k) return 3;
    const subj = load<u32>(subjectEvOff + i * 4);
    const key = load<u32>(eventKeyOff + i * 4);
    if (evHas) {
      if (s < evS) return 6;
      if (s === evS && subj < evSubj) return 6;
      if (s === evS && subj === evSubj && key < evKey) return 6;
    }
    const newRun = !evHas || s !== evS || subj !== evSubj;
    if (newRun || key !== evKey) bump(outOff + s * STRIDE + 8, 1);
    evS = s;
    evSubj = subj;
    evKey = key;
    evHas = true;
  }

  // ---- 罕见病：按（层,主体）去重（同一人在同一层只计 1 例）----
  let rS = -1;
  let rSubj: u32 = 0;
  let rHas = false;
  for (let i = 0; i < nRare; i++) {
    const s = <i32>load<u8>(stratumRareOff + i);
    if (s >= k) return 3;
    const subj = load<u32>(subjectRareOff + i * 4);
    if (rHas) {
      if (s < rS) return 6;
      if (s === rS && subj < rSubj) return 6;
    }
    if (!rHas || s !== rS || subj !== rSubj) bump(outOff + s * STRIDE + 12, 1);
    rS = s;
    rSubj = subj;
    rHas = true;
  }

  return 0;
}
