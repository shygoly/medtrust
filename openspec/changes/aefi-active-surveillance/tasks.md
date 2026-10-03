## 1. 算法模块

- [x] 1.1 AssemblyScript SCRI 模块（ABI `scri@1`，窗口/重叠/分层越界返回码）+ 可复现构建，登记配方 `rws.vaccine-scri@1.0.0`
- [x] 1.2 `scri-model.ts`（编码 / 参考实现）+ 模块与参考实现对拍测试

## 2. 连接器与可信空间节点

- [x] 2.1 封装投影 `scri-registry` / `scri-events` + 编码白名单
- [x] 2.2 节点 `scri-sandbox.ts`（投影 → 沙箱 → 回填 + 不变量）与 `wasm-runner` 角色绑定；`sandbox-runner` 支持 `scri@1`
- [x] 2.3 发布审查：抑制层全部数值置零；载荷不含合计
- [x] 2.4 节点 / 语料销毁回执改用规范签名，补平台口径验签测试

## 3. 平台

- [x] 3.1 模板 `buildVaccineScriPlan` + `POST /mdop/jobs/vaccine-scri` + 收集器
- [x] 3.2 疾控演示参与方、两份数据产品与合约种子
- [x] 3.3 会话见证转发补上数据持有方；作业视图应上报见证节点只取凭证内可信空间节点
- [x] 3.4 结果解读：SCRI 事实清单（RI + 精确 CI）、结论行前置、结论一致性回查

## 4. 控制台

- [x] 4.1 作业页时间窗行 + 分层表；解读载荷 vaccine-scri 分支

## 5. 数据与部署

- [x] 5.1 Synthea 生成接种史 + `build-aefi-records.mjs` 注入信号与答案键
- [x] 5.2 ali29 新增 `rws-worker-c`（疾控，hosp_c 172.27.0.0/16）+ kms-tunnel `HOSP_C_GW` + 防火墙重刷；teeA 部署模块与节点 bundle；api `rel-20261003h`

## 6. 整体测试与物料

- [x] 6.1 真跑 `job-murps5q9-09483c50`：结果与答案键一致；暴露销毁回执验签缺陷 → 修复后 PURGED + 三节点上链
- [x] 6.2 真跑 `job-murqxdaz-533a32d5`（修复见证转发后）：两方「本院核验通过」、结果一致、PURGED、上链 block 179–181
- [x] 6.3 结果解读经 LLMA 真跑：首版结论错误 → 结论前置 + 回查后正确
- [x] 6.4 关键步骤截图（`video/public/shots-intel-aefi/`）与证据归档（`intel-tdx-xeon-showcase/evidence/aefi-scri-20261003/`）
- [x] 6.5 Intel 演示方案改版：摘要、选型分析、截图清单、旁白、视频重渲染
- [x] 6.6 治理契约同步（FLOWS-MDOP-02 持有方核验步、DEPLOY §4.5、external-claims、pilot RECORD §3.10；TRUST 无需改动）+ `check-meta-docs` / `check-tee-claims` 全绿
