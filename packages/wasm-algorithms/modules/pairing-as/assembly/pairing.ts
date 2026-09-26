// 跨持有方**主体配对** —— 平台签名的 Wasm 算法模块（Q4 首选场景、协议 §4.5.2(1)）。
//
// 该模块只做一件事：把宿主写进线性内存的**对齐后的数字列**折算成
// 「交集规模 + 暴露/结局/两者 + 每个分层的计数」。
// 它**不接收**任何主体键文本、也不接收任何记录字段——对齐（共享盐或跨院 PSI）
// 与分层映射都在宿主一侧完成，宿主按下标回填。因此 ABI 对「假名键怎么对齐」**中立**。
//
// ABI v1（小端）：
//   run(inOff: i32, parties: i32, n: i32, strata: i32, outOff: i32) -> i32   (0 = 成功)
//   输入 @inOff:
//     [present: u8[n * parties]]   // 第 p 方是否持有第 i 个主体（行优先：i * parties + p）
//     [exposure: u8[n]]            // 该主体是否被暴露（任一方登记即为 1）
//     [outcome:  u8[n]]            // 该主体是否有结局
//     [stratum:  u8[n]]            // 分层编号 0..strata-1（宿主映射，模块不知含义）
//   输出 @outOff:
//     [cohortSize: u32] [exposed: u32] [outcome: u32] [both: u32]
//     [strata × {exposed: u32, both: u32, cohort: u32}]
//
// 零能力：只导入 env.memory（宿主创建、有上限），不导入任何函数/表/全局量，
// 不调用 WASI，不分配堆内存——全部读写都在宿主给定的地址区间内。
//
// 语义必须与 TS 参考实现 `src/pairing-model.ts#pairIntersection` 逐字段一致；
// 两者用同一组夹具对拍（`scripts/pairing-parity.test.mjs`），漂移即测试红。

/** ABI 版本（导出为 wasm 全局常量，宿主实例化前校验）。 */
export const abi_version: i32 = 1;

export function run(inOff: i32, parties: i32, n: i32, strata: i32, outOff: i32): i32 {
  if (inOff < 0 || outOff < 0 || parties <= 0 || n < 0 || strata < 0) return 1;
  if (parties > 8 || strata > 64) return 2; // 参数越界：宁可拒，不越界读写

  const presentOff = inOff;
  const exposureOff = inOff + n * parties;
  const outcomeOff = exposureOff + n;
  const stratumOff = outcomeOff + n;

  let cohortSize = 0;
  let exposed = 0;
  let outcome = 0;
  let both = 0;

  // 分层累加器：先清零输出区里的三个计数行
  for (let s = 0; s < strata; s++) {
    store<u32>(outOff + 16 + s * 12, 0);
    store<u32>(outOff + 16 + s * 12 + 4, 0);
    store<u32>(outOff + 16 + s * 12 + 8, 0);
  }

  for (let i = 0; i < n; i++) {
    // 求交：每一方都持有才算数
    let all = true;
    for (let p = 0; p < parties; p++) {
      if (load<u8>(presentOff + i * parties + p) == 0) {
        all = false;
        break;
      }
    }
    if (!all) continue;

    const isExposed = load<u8>(exposureOff + i) != 0;
    const isOutcome = load<u8>(outcomeOff + i) != 0;
    const s = load<u8>(stratumOff + i);
    if (<i32>s >= strata) return 3;

    cohortSize++;
    if (isExposed) exposed++;
    if (isOutcome) outcome++;
    if (isExposed && isOutcome) both++;

    const cell = outOff + 16 + s * 12;
    if (isExposed) store<u32>(cell, load<u32>(cell) + 1);
    if (isExposed && isOutcome) store<u32>(cell + 4, load<u32>(cell + 4) + 1);
    store<u32>(cell + 8, load<u32>(cell + 8) + 1);
  }

  store<u32>(outOff, <u32>cohortSize);
  store<u32>(outOff + 4, <u32>exposed);
  store<u32>(outOff + 8, <u32>outcome);
  store<u32>(outOff + 12, <u32>both);
  return 0;
}
