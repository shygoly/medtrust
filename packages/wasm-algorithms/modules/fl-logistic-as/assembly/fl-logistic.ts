// 定点整数逻辑回归训练（Q16.16）—— 平台签名的 Wasm 算法模块（L4 联邦预测，批次 1A）。
//
// 为什么是整数：平台算子 schema 明令「承载受托分析逻辑的算子 MUST 是 wasm 或 oci」
//（packages/mdop/src/schema/operator.ts:19，D-MDOP-5），既有 wasm 模块只做整数
//（ve-tnd.ts 无 f64/exp/log），parity 对拍逐字段相等；而 AS 的 exp/log 与 V8 不保证逐位一致。
// 所以本模块用 Q16.16 定点做批量梯度下降，sigmoid 由**宿主传入的整数查表**实现（模块内零浮点）。
//
// ABI v1（小端；宿主必须显式声明 `rws.l4-train@1.0.0`；模块自述不作数）：
//   run(inOff: i32, n: i32, d: i32, outOff: i32) -> i32      (0 = 成功)
//   输入 @inOff：
//     +0  zMinQ   i32    // 查表域起点（Q16.16，宿主给 -8*Q）
//     +4  zMaxQ   i32    // 查表域终点（Q16.16，宿主给 +8*Q）
//     +8  epochs  u32
//     +12 stepQ   i32    // Q16.16 步长
//     +16 l2Q     i32    // Q16.16 L2
//     +20 lutLen  u32    // 查表条目数（>= 2）
//     +24 pad     i32
//     +28 pad     i32
//     +32 lut[lutLen]    i32   // 各条目 Q16.16，均匀分布于 [zMinQ, zMaxQ]
//         XQ[n*d]        i32   // 行主序 Q16.16 特征
//         y[n]           i32   // 0/1
//   工作区（模块自算，必须落在 inOff 与 outOff 之间）：
//     scratch = align8(inOff + 32 + 4*lutLen + 4*n*d + 4*n)   // gradQ: i64[d]
//   输出 @outOff：
//     thetaQ[d] i32 · interceptQ i32 · nSamples i32 · positives i32
//   错误码：1 n 非法 · 2 d 非法 · 3 查表/域非法 · 4 outOff 太靠前（与工作区重叠）
//
// 零能力：只导入 env.memory（宿主创建、有上限），不导入任何函数/表/全局量，不调用 WASI，
// 不分配堆内存（--runtime stub）—— 全部读写都在宿主给定的地址区间内。
//
// 语义必须与 TS 参考实现 `src/fl-logistic-model.ts#trainFlLogisticQ16` **逐字段一致**；
// 两者用同一组夹具对拍（`scripts/fl-logistic-parity.test.mjs`），漂移即测试红。

/** ABI 版本（导出为 wasm 全局常量，宿主实例化前校验）。 */
export const abi_version: i32 = 1;

/** Q16.16 比例（与宿主约定一致）。 */
const Q: i32 = 65536;
const MAX_N: i32 = 1048576;
const MAX_D: i32 = 4096;

function align8(off: i32): i32 {
  return (off + 7) & ~7;
}

/** 整数 sigmoid（Q16.16 入 / Q16.16 出）：查表 + 整数线性插值，无浮点。 */
function sigmoidQ(
  zQ: i32,
  lutOff: i32,
  lutLen: i32,
  zMinQ: i32,
  zMaxQ: i32,
): i32 {
  const den: i32 = zMaxQ - zMinQ;
  const off: i32 = zQ - zMinQ;
  if (off <= 0) return load<i32>(lutOff);
  if (off >= den) return load<i32>(lutOff + (lutLen - 1) * 4);
  const num: i64 = <i64>off * <i64>(lutLen - 1);
  const i: i32 = <i32>(num / <i64>den);
  const rem: i64 = num - <i64>i * <i64>den;
  const lo: i64 = <i64>load<i32>(lutOff + i * 4);
  const hi: i64 = <i64>load<i32>(lutOff + (i + 1) * 4);
  return <i32>((lo * (<i64>den - rem) + hi * rem) / <i64>den);
}

export function run(inOff: i32, n: i32, d: i32, outOff: i32): i32 {
  if (n <= 0 || n > MAX_N) return 1;
  if (d <= 0 || d > MAX_D) return 2;

  const zMinQ: i32 = load<i32>(inOff);
  const zMaxQ: i32 = load<i32>(inOff + 4);
  const epochs: i32 = <i32>load<u32>(inOff + 8);
  const stepQ: i32 = load<i32>(inOff + 12);
  const l2Q: i32 = load<i32>(inOff + 16);
  const lutLen: i32 = <i32>load<u32>(inOff + 20);
  if (lutLen < 2 || zMaxQ <= zMinQ) return 3;

  const lutOff: i32 = inOff + 32;
  const xOff: i32 = lutOff + lutLen * 4;
  const yOff: i32 = xOff + n * d * 4;
  const gradOff: i32 = align8(yOff + n * 4);
  const need: i32 = d * 4 + 12;
  if (outOff < gradOff + d * 8 || outOff < inOff + need) return 4;

  // thetaQ 直接落在输出区（就地迭代，不分配堆）
  for (let j = 0; j < d; j++) store<i32>(outOff + j * 4, 0);
  let interceptQ: i32 = 0;

  for (let ep = 0; ep < epochs; ep++) {
    for (let j = 0; j < d; j++) store<i64>(gradOff + j * 8, 0);
    let gradB: i64 = 0;
    for (let i = 0; i < n; i++) {
      const rowOff: i32 = xOff + i * d * 4;
      let zQ: i32 = interceptQ;
      for (let j = 0; j < d; j++) {
        const xj: i32 = load<i32>(rowOff + j * 4);
        if (xj !== 0) {
          zQ += <i32>((<i64>xj * <i64>load<i32>(outOff + j * 4)) / <i64>Q);
        }
      }
      const pQ: i32 = sigmoidQ(zQ, lutOff, lutLen, zMinQ, zMaxQ);
      const yQ: i32 = load<i32>(yOff + i * 4) !== 0 ? Q : 0;
      const errQ: i32 = pQ - yQ;
      for (let j = 0; j < d; j++) {
        const xj: i32 = load<i32>(rowOff + j * 4);
        if (xj !== 0) {
          store<i64>(
            gradOff + j * 8,
            load<i64>(gradOff + j * 8) + (<i64>errQ * <i64>xj) / <i64>Q,
          );
        }
      }
      gradB += <i64>errQ;
    }

    let maxStep: i32 = 0;
    for (let j = 0; j < d; j++) {
      const gj: i32 = <i32>(load<i64>(gradOff + j * 8) / <i64>n);
      const reg: i32 = <i32>((<i64>l2Q * <i64>load<i32>(outOff + j * 4)) / <i64>Q);
      const step: i32 = <i32>((<i64>stepQ * <i64>(gj + reg)) / <i64>Q);
      store<i32>(outOff + j * 4, load<i32>(outOff + j * 4) - step);
      const absStep: i32 = step < 0 ? -step : step;
      if (absStep > maxStep) maxStep = absStep;
    }
    const gB: i32 = <i32>(gradB / <i64>n);
    const stepB: i32 = <i32>((<i64>stepQ * <i64>gB) / <i64>Q);
    interceptQ -= stepB;
    const absB: i32 = stepB < 0 ? -stepB : stepB;
    if (absB > maxStep) maxStep = absB;
    if (maxStep === 0) break; // 定点下已无步长可走 = 收敛
  }

  let positives: i32 = 0;
  for (let i = 0; i < n; i++) {
    if (load<i32>(yOff + i * 4) !== 0) positives++;
  }
  store<i32>(outOff + d * 4, interceptQ);
  store<i32>(outOff + d * 4 + 4, n);
  store<i32>(outOff + d * 4 + 8, positives);
  return 0;
}
