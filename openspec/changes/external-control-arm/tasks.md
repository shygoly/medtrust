# 单臂试验真实世界外部对照（D1）任务

> 产出是**可复跑的真实运行**：节点内真实 Wasm + 结果与答案键逐格一致。数据全合成、RR 为注入；
> 对外表述受 `tdx-attestation-pilot/external-claims.md` 约束。勾选只认证据。

## 1. 算子

- [x] 1.1 模块 `rws.external-control@1.0.0`（975B，SM3 391914b7…f43a，可复现构建 + 零能力）。
- [x] 1.2 参考模型 `externalControlCount` / `estimateExternalControl`（Woolf CI + Haldane 校正 + 不可估）。
- [x] 1.3 对拍 7 项（caliper 边界 / 消耗不复用 / 排序契约 6 / 越界 3 / 参数 5 / 不可估 / RR·RD）全绿；包内 95/95。

## 2. 数据与答案键

- [x] 2.1 生成器 `scripts/build-external-control-records.mjs`：460 试验 × 5600 对照（caliper 30 · 1:2），selfCheck pass。
- [x] 2.2 答案键按**投影后形状**（subjectKey := linkKey）计算（D2 坑的修复已固化）。

## 3. 接线

- [x] 3.1 两方最小投影 `sponsor-trial` / `hospital-controls`（缺字段不出院）。
- [x] 3.2 沙箱 ABI `external-control@1` + 形状校验；执行器分支 + 三层不变量。

## 4. 端到端与证据

- [x] 4.1 本地端到端（真投影→真模块→真沙箱→真发布审查→C3）：注入 RR=0.55 三层还原 0.52/0.53/0.58
  （CI 均不含 1）；负例层 1.15（CI 覆盖 1）；**与答案键逐格一致 ✓**。
  证据：`pitch/dr-showcase-20261003/external-control-run.json` + `screenshots/external-control-local-run.png`。
- [x] 4.2 deck 第 6 页替换为真实结果（RR 表 + 执行截图 + 判定列）。

## 5. 真机（待开机）

- [x] 5.1 模块入节点模块库 + teeA TDX 客户机内实测 + 真机截图回填 deck。
  - 完成（2026-10-04 真机）：teeA（Intel TDX）模块库含 5 个按 SM3 命名的模块；客户机内实测
    `Memory Encryption Features active: Intel TDX` + 真实 Quote 5006 字节 + D1 全量数据
    （460 × 5600）逐层结果**与答案键逐格一致 ✓**（RR 0.52/0.52/0.58，CI 不含 1；负例层 1.15 覆盖 1）。
    证据：`pitch/dr-showcase-20261003/tdx-run-all-scenarios.log` + `screenshots/d1-tdx-real-run.png`；
    deck 第 6 页已替换为真机截图。三台按需只开 teeA、跑完即节省停机。

## 6. 后续

- [x] 6.1 verify-rws-datasets.mjs 纳入 D1（真实模块 × 数据集逐格校验）：3/3 全绿（VE / 去重 / 外部对照逐格一致 + 方向断言）。
- [ ] 6.2 MDOP 模板与提交入口（apps/api）——当前演示经执行器直驱。

## 7. 评审遗留（2026-10-08 提交前代码评审）

已当场修掉并补测试的：日期解析不了时原先被写成第 0 天（卡尺静默失效），现在与另两个场景同口径——
接受 `YYYY-MM-DD` 或完整 ISO 时间，解析不了即拒。以下未动，需要决策或另行排期：

- [ ] 7.1 小格是否要过闸：桶 = `min(matched, controls)`，医院侧的 `ctlPos`、以及 `unmatched` 为 1–4 时
  照常发布（design D4 如此约定）。
- [ ] 7.2 输入形状：封存投影把 `ageBand` / `sex` 当可选而节点要求必有（一行不全整阶段失败）；
  `strataKeys` 没有上限（超过 255 会在 `Uint8` 下标回绕，另两个模型封顶 64）；`subjectKey` 只用于排序，
  同一受试者可能匹配成自己的对照；投影里硬编码了 `synthetic` / `dataSource` 两个字段。
- [ ] 7.3 覆盖最薄：连接器侧没有本场景的测试（宿主适配、runner 分支、封存投影），DECISIONS 无对应条目。
- [x] 7.4 通病三条在本场景的落点（同 `cross-hospital-dedup-incidence` 10.5，2026-10-07）：「分层 … 不在 strataKeys」
  这类带行值的报错只留节点本地日志；`strataKeys` 与结果层键过闭合语法、至多 64 个（7.2 的「没有上限」就此封顶，
  其余未动）；封存投影里不合语法的 `ageBand` / `sex` 让封存失败。runner 分支有了首批用例（7.3 仍未完）。
