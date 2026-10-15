> **已撤回（2026-10-15）：见 proposal 顶部说明 —— 改 ABI 的方案被「按块作用域投影 + 拆块计数」取代，以下任务不必执行。**

# 任务

## 1 模块与参考实现
- [ ] 1.1 `modules/categorical-count-as/assembly/categorical-count.ts`：`abi_version = 2`、`MAX_CATEGORIES = 4096`、
      `load<u16>(inOff + (i << 1))`、头注释 ABI v1 → v2；
- [ ] 1.2 `src/categorical-count-model.ts`：`Uint16Array` + 2 字节步长 + 上限 4096 + 越界行为与模块一致；
- [ ] 1.3 `scripts/categorical-count-parity.test.mjs`：加 >64 分类夹具（64/65/4096 边界）；

## 2 宿主接线
- [ ] 2.1 `tee-node/wasm-runner.ts`：`abi: 'categorical-count@2'`；分类键校验上限换 `MAX_CATEGORY_KEYS`（分层键不动）；
- [ ] 2.2 `domain/sandbox/sandbox-runner.ts`：ABI 联合类型加 `'categorical-count@2'`；
- [ ] 2.3 `mdop/node/categorical-count-sandbox.ts`：投影编码改 u16；

## 3 构建与证据
- [ ] 3.1 重建模块（复现构建）并更新 `build/manifest.json` 的 `abiVersion`；
- [ ] 3.2 跑复现闸 + 平行性对拍 + 连接器/api 全量；
- [ ] 3.3 AMR q1/q2/q2-unlock 迁到 MDOP 并真跑（67 键全量分类）；

## 4 台账与文档
- [ ] 4.1 `mdop-rws-ladder-migration` D10.1 更新为已解决；
- [ ] 4.2 三个 AMR demo 迁移后，按配方删 `condition-prevalence` 的旧接线（含 spec 分组与 retained 参照）；
