## 1. 治理先行（元语先改，再动代码）

- [x] 1.1 修订 DECISIONS.md D-CN-2：运行时起步用 V8 WebAssembly（独立 worker 线程），Wasmtime 为目标；模块只允许导入一块有上限的内存；写明 `executionIsolation` 与 `attestationLevel` 正交
- [x] 1.2 TRUST.md 新增控制点「算法模块双重校验 + 零能力 Wasm 执行（fail-closed）」= CTL-20，并更新 P-CTL-5 / P-CTL-6 的现状（第一版已落地）
- [x] 1.3 DOMAIN.md 状态词汇表登记 `executionIsolation: none | wasm-sandbox`，登记派发表新列（executionIsolation/moduleSm3）和合约 `pinnedModules` 条款
- [x] 1.4 FLOWS.md 的 L1.5 步骤注明两条执行路径和执行标注；ARCHITECTURE.md §6.4 更新算法执行现状
- [x] 1.5 DEPLOY.md §2 登记 `CONNECTOR_PLATFORM_CA_PUBKEY`、`CONNECTOR_SANDBOX_TIMEOUT_MS`、`CONNECTOR_SANDBOX_MAX_MEMORY_MB`（+ API 侧 `WASM_ALGORITHMS_DIR`）；`node scripts/check-meta-docs.mjs` 为 0 error

## 2. 算法模块包 packages/wasm-algorithms

- [x] 2.1 新建包 `packages/wasm-algorithms`，锁定 `assemblyscript@0.27.37`；asconfig 固定编译参数（`--runtime stub --importMemory --maximumMemory 1024 --use abort=`）
- [x] 2.2 实现 `assembly/disproportionality.ts`：按 design D3 的 ABI 计算 `cohortSize` 和每个词条的 a/b/c/d，导出 `run` 和 `abi_version = 1`
- [x] 2.3 构建脚本产出 `build/disproportionality.wasm` 和 `manifest.json`（分析类型、ABI、SM3、编译器版本），产物入库（`.gitignore` 显式放行 `build/`）
- [x] 2.4 可复现性检查：从源码重建并比对清单里的 SM3（`packages/wasm-algorithms` 的 `test` 脚本 → 根 `pnpm -r test`）；构建脚本断言只导入 `env.memory`、只导出 run/abi_version/memory

## 3. 连接器沙箱执行器 apps/connector/src/domain/sandbox/

- [x] 3.1 模块校验：SM3 与合约固定值比对；用部署固定的平台 CA 公钥验 SM2 签名；失败记 `sandbox-fail` 并抛错（`sandbox/module-verifier.ts`）
- [x] 3.2 导入导出检查：只允许 `env.memory`；必须导出 `run` 和 `abi_version`，且版本受支持
- [x] 3.3 worker 运行器：`worker_threads`（`env: {}`、`execArgv: []`、`resourceLimits`），宿主注入有上限的 `WebAssembly.Memory`；超时即 `terminate()`；调用前按所需字节数检查内存上限
- [x] 3.4 失衡检测宿主适配：在 `aggregateInternal` 内做最小列投影（按首次出现顺序建立词条下标），调用沙箱，回填 `key`/`rate`，稳定排序，校验输出不变量
- [x] 3.5 本地审计：成功记 `sandbox-run`（SM3、ABI、耗时、内存页数、envVars），失败记 `sandbox-fail`（原因）
- [x] 3.6 单测：SM3 不符、签名无效、导入了函数、ABI 不符、死循环超时、内存超限、不变量违反，全部失败且不回退到 TS；成功路径有审计记录；沙箱内存里不出现词条文本

## 4. 连接器执行路径与标注

- [x] 4.1 `ContractView` 增加 `pinnedModules`；派发记录解析 `module` 引用（`toPendingTask`）
- [x] 4.2 PEP：合约为该分析类型固定了模块时，任务携带的模块 SM3 必须存在且一致，否则 `pep-deny`
- [x] 4.3 `RwsExecutor`：固定了模块就走沙箱路径（仍包在 `SoftwareTee.run` 内），没固定就走 TS 路径
- [x] 4.4 任务执行器在输出闸门之后、规范化与算 SM3 之前写入 `aggregate.execution`
- [x] 4.5 一致性测试：合成/注入信号数据集上，沙箱与 TS 结果逐字段相等（`sandbox.spec.ts`、`execution-annotation.spec.ts`、`testdata/injected-ladder-e2e.spec.ts` 亦可分别过两路径）
- [x] 4.6 回归测试：带 `execution` 的聚合结果，连接器算出的 `aggregateHash` 与 API `aggregateSm3()` 一致（对应 09-15 故障）

## 5. 控制面

- [x] 5.1 数据库：合约表增加 `pinnedModules` 列；`cp_rws_assignment` 增加 `executionIsolation`（缺省 `none`）和 `moduleSm3` 列
- [x] 5.2 CA 服务增加对模块 SM3 的签名（`CaService.signModuleDigest`）；API 启动时从 `packages/wasm-algorithms/build` 装载模块注册表（`AlgorithmModuleRegistry`，SM3 与清单对拍）
- [x] 5.3 新增 `GET /api/v1/connector/modules/:sm3`（连接器鉴权），返回模块字节、SM3、签名、ABI
- [x] 5.4 派发：合约固定了模块时，派发记录携带 `module: { analysisType, sm3 }`
- [x] 5.5 结果入库：读取 `aggregate.execution` 并做枚举校验（非法值返回 400，缺失按 `none`），写入派发表；任务级取所有医院中最弱的一级
- [x] 5.6 存证元数据加入 `executionIsolation` 和模块 SM3 列表，`attestationLevel` 保持不变
- [x] 5.7 合约：`pinnedModules` 计入合约哈希（canonical 归一化）；签发接口支持这一条款（`POST /contracts`、`POST /contracts/:id/approve` 可选 body）；改固定值只能新建合约
- [x] 5.8 API 单测：非法标注被拒、缺失按 `none`、任务级取最弱、存证元数据、合约哈希覆盖 `pinnedModules`

## 6. 前端

- [x] 6.1 RWS 任务详情按医院显示执行隔离：「Wasm 沙箱 + 模块 SM3 前 16 位」或「无隔离（软件、同进程）」；信任级别仍显示 software（`lib/execution-isolation.ts` + 任务详情面板）
- [x] 6.2 合约列表/详情显示「固定算法模块」条款（`pinnedModules` 分析类型 + SM3 前缀）

## 7. 验收与上线（演示结束后再做）

- [x] 7.1 端到端（本地已完成，不含真实演示数据）：真实 API 启动 → 注册表装载 → `GET /connector/modules/:sm3` 返回字节/签名 → 连接器双重校验通过 → 沙箱执行；合约固定 → 派发带 module → PEP → 标注入库 → 存证元数据全链路有集成测试。**待补（ali29 上仍缺）**：全链路合约固定 → 沙箱任务需「药物警戒/AMR 演示数据落到连接器本地库」——ali29 连接器镜像未烘焙 `data/synthetic/amr/connectors/<site>`，disproportionality 任务因「本地数据路径不存在」失败于取数（在执行器分支之前）。单独的数据供给任务，与沙箱部署正交 **已关闭（2026-09-20，wasm-sandbox-live-demo 阶段2）**：AMR 数据已烘焙进连接器，AMR「美罗培南×30天全因死亡」disproportionality 任务命中固定模块合约、经沙箱端到端跑通，executionIsolation=wasm-sandbox、PRR 1.29/ROR 1.37、上链存证。
- [x] 7.2 ali29（2026-09-19 完成）：`CONNECTOR_PLATFORM_CA_PUBKEY` 已配（046eb66d，随 outbound-longpoll 阶段3-4）；API 重建**已把 `packages/wasm-algorithms/build`（模块+清单）打进镜像** + `WASM_ALGORITHMS_DIR` 显式指向它，注册表按 SM3 装载（`b2760b0c…` 与清单一致）并用**当前 CA 动态签名**（与连接器 `CONNECTOR_PLATFORM_CA_PUBKEY` 一致）；连接器已按补丁镜像 + `compose.hardening.yaml` 重建；控制面库已挂卷（重建不再重生 CA，优于原任务假设）
- [x] 7.3 加固环境验证（2026-09-19 完成）：**沙箱在加固连接器容器内运行正确**——真实 `WasmSandboxRunner` + 真实模块在 `medtrust-rws-worker-a`（非 root、只读根 FS：`docker cp` 被拒证实）跑出 `cohortSize=3 a=1 b=1 c=1 d=0`、`envVars=0`（worker 不继承宿主环境→密钥不入沙箱）。**回滚已证**：无固定模块的合约走 TS 路径——线上已完成任务 `executionIsolation=none`（如「cert切换验证·胰岛素」completed）
