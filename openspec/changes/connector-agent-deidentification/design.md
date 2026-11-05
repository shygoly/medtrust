# 设计：院内脱敏下沉到 Python agent

> 关联：`proposal.md`（为什么）· `tasks.md`（分阶段）· TRUST.md（数据最小化）· DECISIONS D-CN-6 / D-CN-7（数据源与最小列投影）

## 1. 目标与非目标

**目标**

- 平台用**签名规格**统一下发脱敏口径，各院执行结果可比、可审计；
- 大数据量与自由文本在**院内 agent**（Python）执行，不经过平台、不出院；
- 任何异常 **fail-closed**：拒绝执行，而不是悄悄弱化脱敏。

**非目标**

- 不做数据出域通道（仍是 C3 结果 + 出域闸门）；
- 不做"平台远程调试 agent"（无交互式 shell、无任意 SQL）；
- v1 不下发可执行代码。

## 2. 职责边界

| 角色 | 负责 | 不负责 |
|---|---|---|
| 平台（`apps/api`） | 签发 DeidSpec、版本/吊销管理、与合约条款绑定、把规格随任务下发 | 不接触数据、不持盐、不持密钥 |
| 连接器（`apps/connector`） | 取规格、验签、吊销检查、**降级检测**、调 agent、校验回执、落审计、入本地存储 | 不逐行处理大表；不得绕过 agent 自脱敏（`agent` 模式） |
| agent（`apps/agent`，院内） | 接收连接器投影后的数据块、按规格变换、回传脱敏块与摘要/回执 | **不持有数据源凭据**；不对外暴露数据、不接受任意代码/SQL、不把样本带出 |
| 医院 KMS/Vault | 持有盐与密钥，按 `salt_ref` 供给 | 不把盐交给平台 |

## 3. 数据流

```
平台                连接器（院内，持数据源权限）          agent（院内）
 │  签发 DeidSpec      │                                     │
 │ ───(签名规格)──────▶│ 1 验签 + SM3 + 版本 + 吊销           │
 │                     │ 2 与合约条款比对（降级检测）          │
 │                     │ 3 从本院数据源读**受限投影**（D-CN-6） │
 │                     │ 4 gRPC 流式发送投影块 + 签名规格 ────▶│ 5 再校验规格（不信任转发）
 │                     │                                     │ 6 从本院 KMS 取盐（salt_ref）
 │                     │◀─── 脱敏块流 + 回执/摘要 ─────────────│ 7 变换 + 本地审计链摘要
 │                     │ 8 校验回执 → 入库/计算 → 出域闸门      │
```

**关键点**：agent 不读取本院数据库，也不持有连接串（`apps/agent/config.py#assert_no_datasource_credentials` 已有启动硬门）；连接器按 D-CN-6 做列裁剪/行过滤后，通过院内 gRPC 流发送块。数据不会进入平台，agent 也不对外暴露数据源。

## 4. DeidSpec（declarative）

```jsonc
{
  "version": 1,
  "id": "deid.ckd.v3",
  "scope": { "product": "urn:tds:sp:ckd-cohort", "level": "C0_internal" },
  "transforms": [
    { "field": "patientId",  "op": "hmac_pseudonym", "params": { "saltRef": "hospital-kms:ckd-2026", "outLen": 32 } },
    { "field": "name",       "op": "drop" },
    { "field": "birthDate",  "op": "generalize",    "params": { "to": "age_band_10" } },
    { "field": "visitDate",  "op": "date_shift",    "params": { "maxDays": 14, "perSubject": true } },
    { "field": "noteText",   "op": "text_rules",    "params": { "rules": ["phone", "id_card", "address", "person_name"], "dictionaryRef": "deid:cn-names:v2" } },
    { "field": "labValue",   "op": "keep" }
  ],
  "quasiIdentifierPolicy": { "k": 5, "suppressIfBelow": true, "columns": ["ageBand", "sex", "region"] },
  "denyIfTransformMissing": ["patientId", "name", "phone", "idCard"]
}
```

- **算子集封闭**：`drop` / `keep` / `generalize` / `hmac_pseudonym` / `date_shift` / `text_rules` / `bucketize` / `truncate` / `suppress`。新增算子要走代码评审与版本升级，不能靠参数扩展出"执行任意表达式"。
- **参数上界**：`k ≥ 5`、`maxDays ≤ 30`、`outLen ≤ 64`；越界拒绝（防"把 k 调成 1"式降级）。
- **`denyIfTransformMissing`**：直接标识字段必须出现在 transforms 里，否则整份规格无效——防"漏掉姓名当成脱敏过"。
- **签名**：`{spec, sm3, signature, keyId=registry, issuedAt, notAfter}`；SM2（注册中心用途密钥，与 CA 根钥分离，CTL-26）。

## 5. 算法下发与准入（复用既有机制）

| 环节 | 机制 | 复用自 |
|---|---|---|
| 签名与用途分离 | 注册中心密钥签算子/模块（`registry` 用途） | `tc609-p1-*` / CTL-26 |
| 完整性 | SM3 + 版本单调，防回放 | `module-client.ts` 的吊销名单版本单调 |
| 吊销 | 随长轮询批次下发，命中即清缓存并拒跑 | `ConnectorModuleClient.applyRevocationList` |
| 降级检测 | 规格与合约 `outputPolicy`/脱敏条款比对（等级、字段集合、k 值） | 新增（本变更） |
| agent 侧再校验 | 不信任连接器转发；校验签名/枚举/上界 | 新增（本变更） |

**为什么不直接下发 Python 包（v1）**：模块分发链路（`/api/v1/connector/modules/:sm3`）已有签名/吊销/白名单，但执行侧是 WASM 沙箱；Python 代码要跑在 agent 里，需要进程隔离、无网络、只读挂载、资源限额与 seccomp，工程量与攻击面都显著更大。v1 先用"封闭算子 + 参数"，把 RCE 通道关死；Phase 2 再按同一准入门槛引入插件。

## 6. 接口（gRPC）

```proto
syntax = "proto3";
package medtrust.deidentify.v1;

service DeidentificationAgent {
  // 双向流：连接器送受限投影块，agent 回脱敏块；数据不进入平台。
  rpc RunDeidentification(stream DeidChunk) returns (stream DeidOutput);
}

message DeidStart {
  string job_id = 1;
  string contract_id = 2;
  string spec_sm3 = 3;       // 必须与 spec_json 的摘要一致
  string spec_json = 4;      // 含签名
  string salt_ref = 5;       // 只引用，不含盐
  int32  row_limit = 6;      // 上限保护
}

message DeidChunk {
  oneof payload {
    DeidStart start = 1;
    bytes projected_jsonl = 2; // 连接器已按 D-CN-6 裁剪/过滤的块
    bool end = 3;
  }
}

message DeidReceipt {
  string ack_status = 1;     // OK | FAILED | DENIED
  int64 row_count = 2;
  string input_digest = 3;   // SM3（脱敏前，按行规范化后）
  string output_digest = 4;  // SM3（脱敏后）
  string spec_sm3 = 5;
  string agent_receipt = 6;  // agent 本地审计链摘要
  repeated string warnings = 7;
  string message = 8;
}

message DeidOutput {
  oneof payload {
    bytes deidentified_jsonl = 1; // 回连接器，仍在院内
    DeidReceipt receipt = 2;
  }
}
```

- 鉴权：沿用 `x-agent-token`（`AGENT_SHARED_TOKEN`，未配置即拒）。
- 超时：默认 120s，`row_limit` 越界即 DENIED；`job_id` 幂等，重复请求不得重复产生输出。
- **数据边界**：流中只有连接器受限投影与脱敏后的块；平台永远不在流路径上，agent 不接收 `input_ref`、SQL 或数据库连接串。

## 7. 失败与降级语义（硬约束）

| 情形 | 行为 |
|---|---|
| 规格验签失败 / SM3 不符 / 已吊销 | 任务 fail-closed；**不退回内置弱脱敏** |
| 规格与合约不一致（如合约要求哈希加盐，规格写 `keep`） | 拒绝，并记审计（降级尝试） |
| `salt_ref` 不可用 | DENIED（不得用恒等/固定盐兜底） |
| agent 不可达 / 超时 | 任务失败并可重试；不得由连接器"本地近似" |
| `row_limit` 超出 | DENIED，提示提高上限需走审批 |
| 变换后仍检出直接标识（`denyIfTransformMissing` 覆盖字段） | FAILED，留在本地排查 |

## 8. 审计与证据

- agent：本地审计链（`{jobId, contractId, specSm3, rowCount, inDigest, outDigest, startedAt, endedAt, ack, prev}`），
  `prev` = 上一条摘要（SM3 前向链接），append-only + fsync，重启不丢（`apps/agent/src/medtrust_agent/deid_audit.py`）。
  **拒绝也留痕**：`DENIED`/`FAILED` 同样写一条，`agent_receipt` = 该条摘要 —— 不留痕的拒跑等于没拒过。
  条目与回执只含元数据与摘要，**不含数据行、样本或字段值**；错误消息只带字段名与标识类别。
- 连接器：记录同一组摘要 + `agent_receipt`；关键事件可锚定到链（可选）。
- 对外材料与评测：**"脱敏"不等于"匿名化"**。重识别风险评估（准标识组合、k 值、自由文本残留）需在 TRUST/EVIDENCE 侧登记控制点，本变更只提供机制，不宣称匿名。

## 8.1 摘要口径（实现补充）

- **输入摘要**：两侧都能独立重算 —— `SM3(逐行 stableStringify(row) + "\n" 顺序拼接)`。
- **输出摘要**：只按 **agent 实际发出的字节**重算（连接器对收到的块按到达顺序累加求 SM3）。
  理由：两侧 JSON 编码器在数值（`3.0` vs `3`）与转义上的差异会让"语义一致"的两份数据得到
  不同摘要，把正常变换误判成篡改；字节口径没有这个歧义。
- **规格摘要**：`spec_json` 与 `spec_sm3` 必须自洽 —— agent 自己重算，不采信连接器转发的值
  （否则"连接器被改过"在 agent 侧看不出来）。

## 9. 与现有实现的关系

- `Deidentifier`（TS）保留为 `builtin` 模式（演示/小数据/无 agent 部署）。
- `agent` 模式下，连接器对"入本地存储"的数据必须来自 agent 的脱敏块流与最终回执（`output_digest`），**禁止**再走本地逐行脱敏绕开口径。
- 迁移期做一致性回归：同一 golden corpus 两模式输出逐字段比对。

## 10. 分期与开放问题

**Phase 1（结构化字段）**：DeidSpec schema + 签名/吊销/降级检测 + proto + agent 内置算子 + 回执 + 负例。
**Phase 2（自由文本）**：`text_rules`（正则 + 词典）→ 可选 NER 插件（沙箱 + 同一准入）。
**Phase 3（跨院对齐）**：可对齐假名（OPRF / 医院共管 HMAC 密钥），独立决策。

**待定**

1. 盐/密钥保管选型：医院 Vault、HSM，还是与 C2 的 KMS 复用？（当前倾向：医院 Vault，C2 不复用）
2. 规格与合约的绑定方式：写进合约条款（`privacy.pseudonymization`）还是合约引用 `deid_spec_id`？（倾向后者，便于版本化与吊销）
3. 大表的输出落点：agent 本地库 or 共享只读卷？（倾向 agent 本地库 + 连接器只拿句柄）
4. 自定义算子需求出现时，走 WASM（连接器内）还是签名 Python 插件（agent 内）？（届时按数据量与语言依赖决定）
