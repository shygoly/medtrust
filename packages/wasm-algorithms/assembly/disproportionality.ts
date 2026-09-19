// L1.5 失衡检测 —— 平台签名的 Wasm 算法模块（D-CN-2 / algorithm-sandbox）。
//
// 该模块只做一件事:把宿主写进线性内存的 0/1 标记列折算成每个事件词条的
// 2×2 计数 (a/b/c/d) 与入组人数。它**不接收**词条文本、主体标识或任何其他
// 记录字段 —— 词条文本留在宿主一侧,宿主按下标回填。
//
// ABI v1 (design D3,小端):
//   run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32   (0 = 成功)
//   输入 @inOff:[included: u8[n]] [exposed: u8[n]] [events: u8[n*k]] (行优先)
//   输出 @outOff:[cohortSize: u32] [a,b,c,d: u32 * k]
//
// 零能力:只导入 env.memory(宿主创建、有上限),不导入任何函数/表/全局量,
// 不调用 WASI,不分配堆内存 —— 全部读写都在宿主给定的地址区间内。

/** ABI 版本(导出为 wasm 全局常量,宿主实例化前校验)。 */
export const abi_version: i32 = 1;

/** 语义与 TS 实现一致:cohortSize = 入组行数;exposed 即"用药";a/c 为事件发生。 */
export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (n < 0 || k < 0 || inOff < 0 || outOff < 0) return 1;

  const includedOff = inOff;
  const exposedOff = inOff + n;
  const eventsOff = inOff + 2 * n;

  let cohortSize = 0;
  let nDrug = 0;
  for (let i = 0; i < n; i++) {
    if (load<u8>(includedOff + i) == 0) continue;
    cohortSize++;
    if (load<u8>(exposedOff + i) != 0) nDrug++;
  }
  const nNoDrug = cohortSize - nDrug;

  store<u32>(outOff, <u32>cohortSize);

  for (let j = 0; j < k; j++) {
    let a = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      if (load<u8>(includedOff + i) == 0) continue;
      if (load<u8>(eventsOff + i * k + j) == 0) continue;
      if (load<u8>(exposedOff + i) != 0) a++;
      else c++;
    }
    const base = outOff + 4 + j * 16;
    store<u32>(base, <u32>a);
    store<u32>(base + 4, <u32>(nDrug - a));
    store<u32>(base + 8, <u32>c);
    store<u32>(base + 12, <u32>(nNoDrug - c));
  }
  return 0;
}
