## 1. 治理先行（元语先改，再动代码）

- [ ] 1.1 修订 DECISIONS.md D-CN-2：运行时起步用 V8 WebAssembly（独立 worker 线程），Wasmtime 为目标；模块只允许导入一块有上限的内存；写明 `executionIsolation` 与 `attestationLevel` 正交
- [ ] 1.2 TRUST.md 新增控制点「算法模块双重校验 + 零能力 Wasm 执行（fail-closed）」，并更新 P-CTL-5 / P-CTL-6 的现状
- [ ] 1.3 DOMAIN.md 状态词汇表登记 `executionIsolation: none | wasm-sandbox`，登记派发表新列和合约 `pinnedModules` 条款
- [ ] 1.4 FLOWS.md 的 L1.5 步骤注明两条执行路径和执行标注；ARCHITECTURE.md §6.4 更新算法执行现状
- [ ] 1.5 DEPLOY.md §2 登记 `CONNECTOR_PLATFORM_CA_PUBKEY`、`CONNECTOR_SANDBOX_TIMEOUT_MS`、`CONNECTOR_SANDBOX_MAX_MEMORY_MB`；`node scripts/check-meta-docs.mjs` 为 0 error

## 2. 算法模块包 packages/wasm-algorithms

- [ ] 2.1 新建包，锁定 AssemblyScript 版本；asconfig 固定编译参数（`--runtime stub --importMemory --maximumMemory <pages> --use abort=`）
- [ ] 2.2 实现 `assembly/disproportionality.ts`：按 design D3 的 ABI 计算 `cohortSize` 和每个词条的 a/b/c/d，导出 `run` 和 `abi_version = 1`
- [ ] 2.3 构建脚本产出 `build/disproportionality.wasm` 和 `manifest.json`（分析类型、ABI、SM3、编译器版本），产物入库
- [ ] 2.4 可复现性检查：从源码重建并比对清单里的 SM3，接入根 `pnpm test`；构建产物只能导入 `env.memory`（加一条断言）

## 3. 连接器沙箱执行器 apps/connector/src/domain/sandbox/

- [ ] 3.1 模块校验：SM3 与合约固定值比对；用部署固定的平台 CA 公钥验 SM2 签名；失败记 `sandbox-fail` 并抛错
- [ ] 3.2 导入导出检查：只允许 `env.memory`；必须导出 `run` 和 `abi_version`，且版本受支持
- [ ] 3.3 worker 运行器：`worker_threads`（`env: {}`、`execArgv: []`、`resourceLimits`），宿主注入有上限的 `WebAssembly.Memory`；超时即 `terminate()`；调用前按所需字节数检查内存上限
- [ ] 3.4 失衡检测宿主适配：在 `aggregateInternal` 内做最小列投影（按首次出现顺序建立词条下标），调用沙箱，回填 `key`/`rate`，稳定排序，校验输出不变量
- [ ] 3.5 本地审计：成功记 `sandbox-run`（SM3、ABI、耗时、内存页数），失败记 `sandbox-fail`（原因）
- [ ] 3.6 单测：SM3 不符、签名无效、导入了函数、ABI 不符、死循环超时、内存超限、不变量违反，全部失败且不回退到 TS；成功路径有审计记录；沙箱内存里不出现词条文本

## 4. 连接器执行路径与标注

- [ ] 4.1 `ContractView` 增加 `pinnedModules`；派发记录解析 `module` 引用
- [ ] 4.2 PEP：合约为该分析类型固定了模块时，任务携带的模块 SM3 必须存在且一致，否则 `pep-deny`
- [ ] 4.3 `RwsExecutor`：固定了模块就走沙箱路径（仍包在 `SoftwareTee.run` 内），没固定就走 TS 路径
- [ ] 4.4 任务执行器在输出闸门之后、规范化与算 SM3 之前写入 `aggregate.execution`
- [ ] 4.5 一致性测试：在 Synthea 合成数据和注入信号数据集上，沙箱与 TS 结果去掉 `execution` 后完全相等
- [ ] 4.6 回归测试：带 `execution` 的聚合结果，连接器算出的 `aggregateHash` 与 API `aggregateSm3()` 一致（对应 09-15 故障）

## 5. 控制面

- [ ] 5.1 数据库：合约表增加 `pinnedModules` 列；`cp_rws_assignment` 增加 `executionIsolation`（缺省 `none`）和 `moduleSm3` 列
- [ ] 5.2 CA 服务增加对模块 SM3 的签名；API 启动时从 `packages/wasm-algorithms/build` 装载模块注册表
- [ ] 5.3 新增 `GET /api/v1/connector/modules/:sm3`（连接器鉴权），返回模块字节、SM3、签名、ABI
- [ ] 5.4 派发：合约固定了模块时，派发记录携带 `module: { analysisType, sm3 }`
- [ ] 5.5 结果入库：读取 `aggregate.execution` 并做枚举校验（非法值返回 400，缺失按 `none`），写入派发表；任务级取所有医院中最弱的一级
- [ ] 5.6 存证元数据加入 `executionIsolation` 和模块 SM3 列表，`attestationLevel` 保持不变
- [ ] 5.7 合约：`pinnedModules` 计入合约哈希；新建合约接口支持这一条款；改固定值只能新建合约
- [ ] 5.8 API 单测：非法标注被拒、缺失按 `none`、任务级取最弱、存证元数据、合约哈希覆盖 `pinnedModules`

## 6. 前端

- [ ] 6.1 RWS 任务详情按医院显示执行隔离：「Wasm 沙箱 + 模块 SM3 前 16 位」或「无隔离（软件、同进程）」；信任级别仍显示 software
- [ ] 6.2 合约详情显示「固定算法模块」条款

## 7. 验收与上线（演示结束后再做）

- [ ] 7.1 端到端：为药物警戒数据产品新建固定模块的合约，跑一次 L1.5，与同一数据的 TS 结果逐字段比对，核对界面和存证上的标注
- [ ] 7.2 ali29：连接器配置 `CONNECTOR_PLATFORM_CA_PUBKEY`；重建 API（会清空控制面 SQLite，之后重跑预跑任务）；连接器按补丁镜像方式更新，重建时必须带 `compose.hardening.yaml`
- [ ] 7.3 在加固环境（非 root、只读根文件系统、无外网）下验证沙箱能运行；回滚演练：新建一份不固定模块的合约，确认回到 TS 路径
