# 设计：ABI v2（u16 分类下标）

## D1 为什么是 u16 而不是别的

- **u16 够用**：研究编码（药敏/菌种/标本/慢病标签）在 4 位数量级，4096 的上界留了余量；
- **u32 不必要**：输入区会变 4 倍宽，零能力模块的内存上界更紧；
- **拆块已被否**（见 proposal「为什么」）—— 模块逐行校验全部标签，块与块互相打架。

## D2 布局与不变量

- 输入 `@inOff`：`[category: u16[n]]`，**小端、2 字节步长**；`k` 仍由宿主显式传入（模块不知语义）；
- 输出 `@outOff`：`[rowCount: u32][k × count: u32]`（与 v1 相同）；
- 错误码不变：5 = 参数非法（n/k 越界）；3 = 分类编号越界；
- `abi_version` 导出常量 1 → **2**（宿主实例化前校验）；
- 零能力不变：只导入 `env.memory`，不导入函数/表/全局量，不调 WASI，不分配堆。

## D3 两套上限必须分离

- **分层键**（`<年龄段>|<性别>`）：上限仍是 `MAX_STRATUM_KEYS = 64`（`packages/mdop/src/schema/stratum-key.ts`）；
- **分类键**（闭合标签集）：上限改为新的 `MAX_CATEGORY_KEYS = 4096`；
- 二者在 `tee-node/wasm-runner.ts` 里由两个校验器把关（`checkedStrataKeys` / `checkedCategoryKeys`），
  这次变更只动后者 —— 否则会把分层键的口径悄悄放宽。

## D4 证据（与 EVIDENCE/PACK 判据对齐）

- **平行性对拍**：`scripts/categorical-count-parity.test.mjs` 现有夹具 + 新增一条 **>64 分类**的夹具（边界：64/65/4096+1）；
- **复现构建闸**：`check-reproducible` 必须仍绿（同一源码 → 同一 SM3）；
- **端到端**：AMR q1（67 键）在节点上跑通，且与 `retained(test-reference)` 的旧链口径（`conditionPrevalence` 的参照）逐字段对拍；
- 台账 `mdop-rws-ladder-migration` 的 D10.1 更新为「已按 u16 解决」，并把 AMR 三型迁走。

## D5 兼容矩阵

| 宿主 | 模块 | 结果 |
|---|---|---|
| `@2` | v2 | 正常 |
| `@1` | v2 / `@2` | v1 | `abi_version` 校验拒绝（fail-closed）|
