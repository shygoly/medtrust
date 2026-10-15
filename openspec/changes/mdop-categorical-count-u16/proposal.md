# 分类计数模块索引位宽 u8 → u16（ABI v2）

## 为什么

`mdop-rws-ladder-migration` 的 **D10.1**：AMR 三型（`run-amr-q1/q2/q2-unlock`）的 condition-prevalence 在节点上跑不通 ——
数据的研究相关分类键（`specimen:*` / `organism:*` / `resist:*`）共 **67** 项，而 `rws.categorical-count` 的 ABI 用
**u8 下标**（`MAX_CATEGORIES = 64`），节点按闭合语法正确拒绝。

**拆块计数已实测不可行**：模块语义是「逐行取出该行的**全部**分类标签，遇到不在本块列表里的就拒」，
所以每一块都必须声明全集才不被别的块拒，而那样每块又超 64（实测报 `分类键不在给定列表里：specimen:BLOOD`）。

## 做什么

把该模块的**分类下标位宽**从 u8 提到 u16（ABI v2）：

- 输入区改为 `[category: u16[n]]`（**2 字节步长**），`MAX_CATEGORIES` 提到 4096（覆盖研究编码、同时给内存上界）；
- 同步改 TS 参考实现 `packages/wasm-algorithms/src/categorical-count-model.ts`；
- 宿主 ABI 标签 `categorical-count@1` → `@2`（`tee-node/wasm-runner.ts`、`domain/sandbox/sandbox-runner.ts`）；
- **分类键**校验上限与**分层键**的 64 上限**分离**（分层键口径不变）；
- 复现构建重建模块，跑平行性对拍与复现闸，并补一条 **>64 分类**的对拍夹具。

## 不做什么

- 不改其他模块（distinct-count / dedup-incidence / ve-tnd / pairing … 仍 u8）；
- **不放宽分层键**（`<年龄段>|<性别>`）的 64 上限 —— 那是另一套闭合语法；
- 不动「闭合分类键」语义：未声明的分类仍然拒（fail-closed）。

## 影响与回滚

- 宿主与模块必须同版本：跨版本由既有 `abi_version` 全局校验拦下（fail-closed），不会静默错算；
- 回滚 = 回到 ABI v1 的模块与标签（本变更不改数据、不改台账）。
