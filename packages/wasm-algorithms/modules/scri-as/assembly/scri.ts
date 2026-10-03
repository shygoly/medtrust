// 疫苗接种后不良事件 **自身对照风险期（SCRI）计数** —— 平台签名的 Wasm 算法模块。
//
// 场景：接种记录在免疫规划（疾控），就诊结局在医院。宿主在可信空间节点内把两方
// 按跨院关联假名对齐后，算出每一对「接种剂次 × 事件」的间隔天数，连同分层编号写进线性内存；
// 本模块只做一件事：按风险期 / 对照期计数，并统计每个分层的接种剂次数。
// 它**不接收**任何主体键、日期或编码文本——对齐、日期差与分层映射都在宿主一侧完成。
//
// ABI v1（小端）：
//   run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32   (0 = 成功)
//     n = 「剂次 × 事件」配对条数，k = 分层数
//   输入 @inOff:
//     [riskStart: i32] [riskEnd: i32] [controlStart: i32] [controlEnd: i32] [doses: i32]
//     [dayDiff:   i32[n]]     // 事件日期 − 接种日期（天）
//     [pairStratum: u8[n]]    // 该配对所属分层（取接种侧的年龄段 | 性别）
//     [doseStratum: u8[doses]]// 每个接种剂次所属分层
//   输出 @outOff:
//     k × { riskEvents: u32, controlEvents: u32, doses: u32 }
//
// 窗口为闭区间 [start, end]，两窗不得重叠（重叠即拒：同一事件不能同时算作风险与对照）。
//
// 零能力：只导入 env.memory，不导入任何函数/表/全局量，不分配堆内存。
// 语义必须与 TS 参考实现 `src/scri-model.ts#scriCount` 逐字段一致（`scripts/scri-parity.test.mjs` 对拍）。

/** ABI 版本（导出为 wasm 全局常量，宿主实例化前校验）。 */
export const abi_version: i32 = 1;

const MAX_STRATA: i32 = 64;
const HEADER: i32 = 20;

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (inOff < 0 || outOff < 0 || n < 0 || k < 0) return 1;
  if (k > MAX_STRATA) return 2;

  const riskStart = load<i32>(inOff);
  const riskEnd = load<i32>(inOff + 4);
  const controlStart = load<i32>(inOff + 8);
  const controlEnd = load<i32>(inOff + 12);
  const doses = load<i32>(inOff + 16);
  if (riskStart > riskEnd || controlStart > controlEnd || doses < 0) return 4;
  // 两窗重叠即拒
  if (!(riskEnd < controlStart || controlEnd < riskStart)) return 5;

  const diffOff = inOff + HEADER;
  const pairStratumOff = diffOff + n * 4;
  const doseStratumOff = pairStratumOff + n;

  for (let s = 0; s < k; s++) {
    store<u32>(outOff + s * 12, 0);
    store<u32>(outOff + s * 12 + 4, 0);
    store<u32>(outOff + s * 12 + 8, 0);
  }

  for (let i = 0; i < n; i++) {
    const d = load<i32>(diffOff + i * 4);
    const s = <i32>load<u8>(pairStratumOff + i);
    if (s >= k) return 3;
    const cell = outOff + s * 12;
    if (d >= riskStart && d <= riskEnd) store<u32>(cell, load<u32>(cell) + 1);
    else if (d >= controlStart && d <= controlEnd) store<u32>(cell + 4, load<u32>(cell + 4) + 1);
  }

  for (let j = 0; j < doses; j++) {
    const s = <i32>load<u8>(doseStratumOff + j);
    if (s >= k) return 3;
    const cell = outOff + s * 12 + 8;
    store<u32>(cell, load<u32>(cell) + 1);
  }
  return 0;
}
