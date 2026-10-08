// 疫苗真实世界保护效果（检测阴性设计 TND）—— 平台签名的 Wasm 算法模块。
//
// 模块只做一件事：把宿主写进线性内存的**数字列**折算成
// 「每个分层 × 六个格」的计数（已接种 / 未接种 / 部分免疫 × 阳性 / 阴性）。
//
// 宿主负责的是**跨机构对齐**那一半：按关联假名把疾控的接种记录与医院的检测记录配到同一个人，
// 取「检测日当天或之前最后一剂」，算出间隔天数，再做分层编号映射。
// 模块**不接收**任何主体键文本、日期文本或编码文本 —— 因此 ABI 对「假名怎么对齐」中立。
//
// ABI v1（小端；宿主必须显式声明 `ve-tnd@1`，模块自述不作数）：
//   run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32   (0 = 成功)
//   输入 @inOff:
//     [immuneDays: i32]        // 免疫建立期天数（≥1，模板参数化；演示 14）
//     [gapDays: i32[n]]        // 检测日 − 检测日前最后一剂接种日；INT32_MIN = 该人无接种记录
//     [result: u8[n]]          // 1 = 阳性，0 = 阴性
//     [stratum: u8[n]]         // 0..k-1（宿主映射）
//   输出 @outOff:
//     k × [vaccPos, vaccNeg, unvaccPos, unvaccNeg, partialPos, partialNeg] (u32)
//
// 返回码：0 成功；3 分层编号越界；5 参数非法（immuneDays<1 / n<0 / k<1 / result 非 0/1 / 区间重叠）。
//
// 零能力：只导入 env.memory（宿主创建、有上限），不导入任何函数/表/全局量，
// 不调用 WASI，不分配堆内存 —— 全部读写都在宿主给定的地址区间内。
//
// 语义必须与 TS 参考实现 `src/ve-tnd-model.ts#veTndCount` 逐字段一致；
// 两者用同一组夹具对拍（`scripts/ve-tnd-parity.test.mjs`），漂移即测试红。

/** ABI 版本（导出为 wasm 全局常量，宿主实例化前校验）。 */
export const abi_version: i32 = 1;

const HEADER: i32 = 4;
/** i32 最小值：宿主用它表示「检测日前没有任何目标疫苗接种记录」。 */
const NO_DOSE: i32 = -2147483648;
/** 每层格数：vaccPos/vaccNeg/unvaccPos/unvaccNeg/partialPos/partialNeg。 */
const CELLS: i32 = 6;

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (inOff < 0 || outOff <= inOff || n < 0 || k < 1) return 5;
  const immuneDays = load<i32>(inOff);
  if (immuneDays < 1) return 5;

  const gapOff = inOff + HEADER;
  const resultOff = gapOff + n * 4;
  const stratumOff = resultOff + n;

  // 清零输出（抑制/未出现的格必须是 0，而不是宿主内存里的残留）
  for (let s = 0; s < k; s++) {
    for (let c = 0; c < CELLS; c++) store<u32>(outOff + s * CELLS * 4 + c * 4, 0);
  }

  for (let i = 0; i < n; i++) {
    const s = <i32>load<u8>(stratumOff + i);
    if (s >= k) return 3;
    const r = <i32>load<u8>(resultOff + i);
    if (r !== 0 && r !== 1) return 5;
    const gap = load<i32>(gapOff + i * 4);

    let cell: i32;
    if (gap === NO_DOSE || gap < 0) {
      // 未接种（含「检测发生在首剂之前」：宿主给 NO_DOSE 或负数间隔）
      cell = r === 1 ? 2 : 3;
    } else if (gap >= immuneDays) {
      cell = r === 1 ? 0 : 1; // 已接种（免疫建立期已过）
    } else {
      cell = r === 1 ? 4 : 5; // 部分免疫（0 ≤ gap < immuneDays，单列、不入主分析）
    }
    const addr = outOff + s * CELLS * 4 + cell * 4;
    store<u32>(addr, load<u32>(addr) + 1);
  }
  return 0;
}
