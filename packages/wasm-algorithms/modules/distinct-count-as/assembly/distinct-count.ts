// 按分层统计**去重主体数** —— 平台签名的 Wasm 算法模块（C2 T6）。
//
// 该模块只做一件事：把宿主写进线性内存的**数字列**折算成
// 「全体去重人数 + 每个分层的去重人数」。
// 它**不接收**任何主体键文本、也不接收任何记录字段——对齐与分层映射
// 都在宿主一侧完成，宿主按下标回填。因此 ABI 对「假名键怎么对齐」**中立**。
//
// ABI v1（小端，宿主必须显式声明 `distinct-count@1`；模块自述不作数）：
//   run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32   (0 = 成功)
//   输入 @inOff:
//     [subject: u32[n]]   // 主体编号（宿主映射，模块不知含义）
//     [stratum: u8[n]]    // 分层编号 0..k-1（宿主映射）
//   工作区（模块自算，必须落在 inOff 与 outOff 之间）：
//     scratch = align8(inOff + 5n)；[keys: u64[n]]  // (stratum << 32) | subject
//   输出 @outOff:
//     [totalDistinct: u32]
//     [k × {distinct: u32}]
//
// 零能力：只导入 env.memory（宿主创建、有上限），不导入任何函数/表/全局量，
// 不调用 WASI，不分配堆内存——全部读写都在宿主给定的地址区间内。
//
// 语义必须与 TS 参考实现 `src/distinct-count-model.ts#distinctCount` 逐字段一致；
// 两者用同一组夹具对拍（`scripts/distinct-count-parity.test.mjs`），漂移即测试红。

/** ABI 版本（导出为 wasm 全局常量，宿主实例化前校验）。 */
export const abi_version: i32 = 1;

const MAX_STRATA: i32 = 64;
const MAX_N: i32 = 1048576;

function align8(off: i32): i32 {
  return (off + 7) & ~7;
}

function loadKey(off: i32, i: i32): u64 {
  return load<u64>(off + (i << 3));
}

function storeKey(off: i32, i: i32, value: u64): void {
  store<u64>(off + (i << 3), value);
}

function swapKey(off: i32, a: i32, b: i32): void {
  const tmp = loadKey(off, a);
  storeKey(off, a, loadKey(off, b));
  storeKey(off, b, tmp);
}

function siftDown(off: i32, n: i32, root: i32): void {
  let cur = root;
  while (true) {
    const left = (cur << 1) + 1;
    if (left >= n) break;
    let cand = left;
    const right = left + 1;
    if (right < n && loadKey(off, right) > loadKey(off, left)) cand = right;
    if (loadKey(off, cand) <= loadKey(off, cur)) break;
    swapKey(off, cur, cand);
    cur = cand;
  }
}

function heapSort(off: i32, n: i32): void {
  if (n < 2) return;
  for (let i = (n >> 1) - 1; i >= 0; i--) siftDown(off, n, i);
  for (let end = n - 1; end > 0; end--) {
    swapKey(off, 0, end);
    siftDown(off, end, 0);
  }
}

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (inOff < 0 || outOff < 0 || n < 0 || k < 0) return 1;
  if (k > MAX_STRATA || n > MAX_N) return 2;

  const subjectOff = inOff;
  const stratumOff = inOff + (n << 2);
  const scratchOff = align8(stratumOff + n);
  const scratchEnd = scratchOff + (n << 3);
  if (n > 0 && outOff < scratchEnd) return 2;

  for (let s = 0; s < k; s++) {
    store<u32>(outOff + 4 + (s << 2), 0);
  }

  if (n == 0) {
    store<u32>(outOff, 0);
    return 0;
  }

  // 先按 (stratum, subject) 排序，再扫出每个分层的去重人数。
  for (let i = 0; i < n; i++) {
    const stratum = <i32>load<u8>(stratumOff + i);
    if (stratum >= k) return 3;
    const subject = <u64>load<u32>(subjectOff + (i << 2));
    storeKey(scratchOff, i, ((<u64>stratum) << 32) | subject);
  }
  heapSort(scratchOff, n);

  let prevStratum: i32 = -1;
  let prevSubject: u64 = 0;
  let havePrev = false;
  for (let i = 0; i < n; i++) {
    const key = loadKey(scratchOff, i);
    const stratum = <i32>(key >> 32);
    const subject = key & 0xffffffff;
    if (!havePrev || stratum != prevStratum || subject != prevSubject) {
      const cell = outOff + 4 + (stratum << 2);
      store<u32>(cell, load<u32>(cell) + 1);
    }
    prevStratum = stratum;
    prevSubject = subject;
    havePrev = true;
  }

  // 全体去重：复用工作区，只按 subject 排序后扫唯一值。
  for (let i = 0; i < n; i++) {
    storeKey(scratchOff, i, <u64>load<u32>(subjectOff + (i << 2)));
  }
  heapSort(scratchOff, n);
  let total: u32 = 1;
  let last = loadKey(scratchOff, 0);
  for (let i = 1; i < n; i++) {
    const cur = loadKey(scratchOff, i);
    if (cur != last) {
      total++;
      last = cur;
    }
  }
  store<u32>(outOff, total);
  return 0;
}
