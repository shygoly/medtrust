/**
 * 跨持有方**主体配对**的语义（Q4 首选场景：跨院队列交集，协议 §4.5.2(1)）。
 *
 * 为什么必须放在节点内：A 方只有暴露记录、B 方只有结局记录，要算「暴露者中的事件发生率」
 * 必须**按主体把两边的行接起来**。C3 聚合出域做不到这件事——各方的边际计数**无法求交**：
 * 真实交集在 `[max(0, a+b−n), min(a,b)]` 之间，区间宽度大于 0 时任何聚合量都定不了它（数学上无解，
 * 不是工程难度）。本文件把这两件事都写成可复跑的代码：`joinableBounds` 给出 C3 的不可判定区间，
 * `pairIntersection` 给出节点内按主体配对后的结果。
 *
 * 算子形态：协议 §5.1 只许 `wasm` / `oci` 承载受托分析逻辑（`system` 只允许 source/seal/declassify/merge）。
 * 因此本语义的真实部署形态是**注册中心签发的 `wasm` 模块**（category `collab`），模块在
 * `@medtrust/wasm-algorithms`（`modules/pairing-as`，数字列 ABI，决策中立），
 * 参考语义与它**同源**（`src/pairing-model.ts`）并用同一组夹具对拍——
 * 本文件只是把它转发出来，**不另存一份实现**（两份实现漂移是这类模块最容易出的坑）。
 */

export {
  encodeForModule,
  joinableBounds,
  pairIntersection,
  type ModuleInput,
  type PairCell,
  type PairPartyTable,
  type PairResult,
  type PairStrata,
  type PseudonymRow,
} from '@medtrust/wasm-algorithms';
