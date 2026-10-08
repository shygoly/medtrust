// 单臂试验的真实世界外部对照 —— 平台签名的 Wasm 算法模块（D1，乐城主线场景）。
//
// 模块只做一件事：把宿主写进线性内存的**数字列**（试验组与对照池两侧已按
// 「分层, 索引日」排序的日期与结局列）做**确定性窗口匹配**，折算成
// 「每个分层 × 六个格」的计数（匹配试验组的 阳/阴、被匹配对照的 阳/阴、匹配数、未匹配数）。
//
// 为什么这一步必须在节点内：外部对照需要把申办方试验受试者与医院历史病例
// **逐人配对**（同层、索引日相近），任何一方单独都拿不到对方的数据；
// 聚合式/联邦方法做不了患者级匹配。
//
// 匹配规则（确定性，无随机性、无堆内存、无匹配状态暂存）：
//   两侧同层内按索引日升序；对每个试验受试者（按日升序处理）：
//   ① 丢弃「日 < 受试者日 − caliper」的对照（后续受试者日只会更晚，永不可用）；
//   ② 在「|对照日 − 受试者日| ≤ caliper」窗口内**从最早起**取至多 ratioK 个对照；
//   ③ 取到 ≥1 个即记「匹配」，消耗所取对照；一个也取不到记「未匹配」。
//   说明：窗口内取最早（而非最近）是为了让模块不需要任何暂存区标记「已用」——
//   排序 + 单调指针即可完成，语义仍确定、可复现、可对拍。
//
// ABI v1（小端；宿主必须显式声明 `external-control@1`，模块自述不作数）：
//   run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32   (0 = 成功)
//   n = nTrial + nCtrl（总行数）；k = 分层数 S
//   输入 @inOff:
//     [nTrial: i32][nCtrl: i32][caliperDays: i32][ratioK: i32]   // 头 16 字节
//     试验组（nTrial 行）: [indexDay: i32[nT]][outcome: u8[nT]][stratum: u8[nT]]
//     对照池（nCtrl 行）: [indexDay: i32[nC]][outcome: u8[nC]][stratum: u8[nC]]
//   输出 @outOff: k × [mExpPos, mExpNeg, ctlPos, ctlNeg, matched, unmatched] (u32)
//
// 返回码：0 成功；3 分层编号越界；5 参数非法（caliper<0 / ratioK<1 / outcome 非 0/1 / 行数<0）；
//         6 排序契约被破坏（任一侧未按「分层升序、同层日内升序」排序——宁可拒绝也不悄悄算错）。
//
// 零能力：只导入 env.memory，不导入任何函数/表/全局量，不调用 WASI，不分配堆内存。
// 语义必须与 TS 参考实现 `src/external-control-model.ts#externalControlCount` 逐字段一致；
// 两者用同一组夹具对拍（`scripts/external-control-parity.test.mjs`），漂移即测试红。

export const abi_version: i32 = 1;

const HEADER: i32 = 16;
const CELLS: i32 = 6;

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (inOff < 0 || outOff <= inOff || k < 1 || n < 0) return 5;
  const nT = load<i32>(inOff);
  const nC = load<i32>(inOff + 4);
  const caliper = load<i32>(inOff + 8);
  const ratioK = load<i32>(inOff + 12);
  if (nT < 0 || nC < 0 || nT + nC !== n || caliper < 0 || ratioK < 1) return 5;

  const tDayOff = inOff + HEADER;
  const tOutOff = tDayOff + nT * 4;
  const tStrOff = tOutOff + nT;
  const cDayOff = tStrOff + nT;
  const cOutOff = cDayOff + nC * 4;
  const cStrOff = cOutOff + nC;

  // 排序契约：两侧均须「分层不降、同层索引日不降」
  for (let i = 1; i < nT; i++) {
    const ps = <i32>load<u8>(tStrOff + i - 1), cs = <i32>load<u8>(tStrOff + i);
    if (ps > cs || (ps === cs && load<i32>(tDayOff + (i - 1) * 4) > load<i32>(tDayOff + i * 4))) return 6;
  }
  for (let j = 1; j < nC; j++) {
    const ps = <i32>load<u8>(cStrOff + j - 1), cs = <i32>load<u8>(cStrOff + j);
    if (ps > cs || (ps === cs && load<i32>(cDayOff + (j - 1) * 4) > load<i32>(cDayOff + j * 4))) return 6;
  }
  for (let i = 0; i < nT; i++) if (<i32>load<u8>(tStrOff + i) >= k) return 3;
  for (let j = 0; j < nC; j++) if (<i32>load<u8>(cStrOff + j) >= k) return 3;
  for (let i = 0; i < nT; i++) { const o = <i32>load<u8>(tOutOff + i); if (o !== 0 && o !== 1) return 5; }
  for (let j = 0; j < nC; j++) { const o = <i32>load<u8>(cOutOff + j); if (o !== 0 && o !== 1) return 5; }

  for (let s = 0; s < k; s++)
    for (let c = 0; c < CELLS; c++) store<u32>(outOff + s * CELLS * 4 + c * 4, 0);

  let ptr = 0; // 对照单调指针（同层内已消耗/已丢弃的边界）
  for (let i = 0; i < nT; i++) {
    const s = <i32>load<u8>(tStrOff + i);
    const day = load<i32>(tDayOff + i * 4);
    const lo = day - caliper;
    // ① 丢弃过早的对照（分层更小，或同层但早于窗口下界）
    while (ptr < nC) {
      const ps = <i32>load<u8>(cStrOff + ptr);
      if (ps < s) { ptr++; continue; }
      if (ps === s && load<i32>(cDayOff + ptr * 4) < lo) { ptr++; continue; }
      break;
    }
    // ② 窗口内从最早起取至多 ratioK 个（ps > s 时窗口为空，自然不取）
    let taken = 0, j = ptr;
    while (taken < ratioK && j < nC) {
      const ps = <i32>load<u8>(cStrOff + j);
      if (ps !== s) break;
      if (load<i32>(cDayOff + j * 4) > day + caliper) break;
      const cell = <i32>load<u8>(cOutOff + j) === 1 ? 2 : 3;
      const addr = outOff + s * CELLS * 4 + cell * 4;
      store<u32>(addr, load<u32>(addr) + 1);
      taken++; j++;
    }
    const base = outOff + s * CELLS * 4;
    if (taken > 0) {
      store<u32>(base + 16, load<u32>(base + 16) + 1); // matched（第 4 格，偏移 16）
      const mcell = <i32>load<u8>(tOutOff + i) === 1 ? 0 : 1; // 匹配试验组的阳/阴
      store<u32>(base + mcell * 4, load<u32>(base + mcell * 4) + 1);
      ptr = j; // 消耗所取对照
    } else {
      store<u32>(base + 20, load<u32>(base + 20) + 1); // unmatched
    }
  }
  return 0;
}
