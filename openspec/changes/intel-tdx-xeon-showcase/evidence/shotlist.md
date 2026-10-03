# 截图与画面清单（intel-tdx-xeon-showcase 任务 5.1）

> 规则：成片里的每个系统画面要么是线上控制台的**真实截图**，要么是真实运行日志的**原文摘录**；
> 示意图只画拓扑与流程。全部来自 2026-10-03 的同一次真实运行（合成数据）。
> 采集方式：`video/scripts/capture-intel-shots.mjs`（经 SSH 隧道访问线上 web/api；会话由服务器侧
> `mt-session` 注入，脚本不含任何口令）。

## 1. 线上控制台截图（`evidence/screenshots/`，3840×2160）

| 文件 | 画面 | 对应证据 | 机器 | 采集时间（UTC） |
|---|---|---|---|---|
| `job_top.png` | 作业详情：6 个阶段全部 SUCCEEDED、片段哈希、执行凭证（tdx / 度量 / 5.1.3） | `e2e-20261003/job-job-mur9q5ac-c7088283.json` | ali29（平台） | 见 `screenshots/shots.json` |
| `job_result.png` | 合并结果（C3）与发布审查汇总 | 同上 `result` / `release_manifest` | ali29 | 同上 |
| `job_interpret_running.png` | 结果解读：请求已发往推理机 | `e2e-20261003/interpretation.json` | ali29 → LLMA | 同上 |
| `job_interpret_done.png` | 同屏：凭证、会话证明、C3 结果、解读（事实清单 + 草稿 + 供应商/模型）、三方回执链上链 | 同上两份 | ali29 / LLMA | 同上 |
| `job_anchors.png` | 审计回执链与锚定（block 53 / 54 / 55） | 作业记录 `anchors` | ali29 + 链 | 同上 |
| `job_full.png` | 作业详情整页 | 作业记录 | ali29 | 同上 |

页面如实显示的不足也保留在截图里：会话证明「尚未核验」（两院未独立核验见证）、作业状态为 SUCCEEDED 而非 PURGED。

## 2. 日志原文摘录（成片里的终端画面）

| 场景 | 行内容来源 | 证据文件 |
|---|---|---|
| 证明（teeA `advertise` / `probe`） | 命令输出原文 | `tdx-attestation-pilot/evidence/product-chain-20261003/teeA-node.log` |
| 校验方背书与平台登记 | `[背书] …` 行原文 | 同目录 `teeB-platform-registration.log` |
| 上链 | `Attestation on-chain: tx=… block=47` | 同目录 `platform-anchor.log` |
| 医院取数 / 封存 | `source.dataset 载入` / `封装完成` | `e2e-20261003/ali29-platform-and-hospitals.log` |
| 托付 / 释放 | `[托付]` / `[释放]` 行原文 | `e2e-20261003/teeB-verifier-kms.log` |
| 节点内配对 / 发布审查 / 预算 | `阶段执行完成` / `发布审查通过` / `查询预算扣减` | `e2e-20261003/teeA-node.log` |

摘录只做截断与合并同类行（如两院的「信封已中继」并成一行），不改数值、不改顺序含义。
`tdx-sidecar verify → chain: intel-sgx-root-ca · collateral: intel-pcs · ok` 一行是 sidecar JSON 输出的字段拼写，非日志原句。

## 3. 推理机事实（角标「Xeon 6 6982P-C · AMX / OVMS 2026.4.0 / Qwen3-1.7B int4」）

`evidence/llma/host-facts.txt`（CPU 型号与 AMX 标志、OVMS 版本、模型文件摘要）、`evidence/llma/ovms-startup.log`。
注：`host-facts.txt` 首次采集时常驻模型是 0.6B，后切换为 1.7B；1.7B 的模型文件摘要在文件末尾追加行。

## 4. 未进入成片的画面

- 「存证账本」页：该页是另一套台账（任务/策略/结果存证），不显示节点证明登记；节点证明的上链以日志为证。
- 「本院连接器」页：仅医院账号可见，未采集。
- 没有任何速度/吞吐画面（不做性能主张）。

## 5. 示意画面（不是系统截图）

成片前半段的平台介绍（愿景三支柱、三部分架构、协同计算与分析阶梯）与选型论证（交集维恩图、横向/纵向切分示意、MPC 与 TEE 对比表、TEE 取舍）是**示意图与文字卡**，内容依据：
`docs/architecture-overview.html`（架构与七条不变量、「可分解性」判据）、平台路演稿（愿景三支柱与三方痛点）、
`pitch/intel-showcase-20261003/场景技术选型分析-为何必须用TEE.md`（选型论证）。路演稿中未经核实的市场与政策数字未进入成片。
