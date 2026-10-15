// 按分类字段**计数出现次数** 平台签名的 Wasm 算法模块（批次 2）。
//
// 与 distinct-count 的区别只有一处：那个数**去重主体**，这个数**出现次数**（旧链 L0/L1 的口径）。
// 其余（零能力、纯数字列、宿主映射键、不导入任何函数）完全一致。
//
// ABI v1（小端，宿主必须显式声明 `categorical-count@1`；模块自述不作数）：
//   run(inOff: i32, n: i32, k: i32, outOff: i32) -> i32   (0 = 成功)
//   输入 @inOff:
//     [category: u8[n]]   // 分类编号 0..k-1（宿主映射，模块不知含义）
//   输出 @outOff:
//     [rowCount: u32]   // = n（参与计数的行数）
//     [k  {count: u32}]   // 每个分类的出现次数
//
// 错误码：5 = 参数非法（n/k 越界）；3 = 分类编号越界。
// 零能力：只导入 env.memory（宿主创建、有上限），不导入任何函数/表/全局量，不调用 WASI，不分配堆。
//
// 语义必须与 TS 参考实现 `src/categorical-count-model.ts#categoricalCount` 逐字段一致；
// 两者用同一组夹具对拍（`scripts/categorical-count-parity.test.mjs`），漂移即测试红。

/** ABI 版本（导出为 wasm 全局常量，宿主实例化前校验）。 */
export const abi_version: i32 = 1;

const MAX_CATEGORIES: i32 = 64;
const MAX_N: i32 = 1048576;

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (n < 0 || n > MAX_N) return 5;
  if (k < 1 || k > MAX_CATEGORIES) return 5;

  // 清零输出区（rowCount + k 个计数）
  for (let c = 0; c <= k; c++) store<u32>(outOff + (c << 2), 0);

  for (let i = 0; i < n; i++) {
    const idx = load<u8>(inOff + i);
    if (<i32>idx >= k) return 3;
    const at = outOff + ((<i32>idx + 1) << 2);
    store<u32>(at, load<u32>(at) + 1);
  }
  store<u32>(outOff, n);
  return 0;
}
