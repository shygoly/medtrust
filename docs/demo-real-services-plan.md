# MedTrust 真实服务 Demo 计划

## 概览

基于已部署的 8 个真实 Fly.io 服务和已植入的 CKD 场景种子数据，设计可执行的 7 步联邦可信数据空间全流程演示。

**目标场景**：恒瑞医药发起「慢性肾病(CKD)进展预测 · 多模态联邦微调」，三家上海医院参与，数据不出域，链上存证，按贡献结算。

---

## 当前生产环境状态

| 服务 | 地址 | 协议 | 健康状态 | 关键能力 |
|------|------|------|----------|----------|
| **medtrust-api** | `https://medtrust-api.fly.dev` | HTTP REST | healthy | 控制面（catalog/contracts/tasks/settlements/audit/blockchain） |
| **medtrust-chain** | `https://medtrust-chain.fly.dev` | HTTP REST | healthy（block=12） | ChainMaker 存证（/health, /block-number, /attest） |
| **medtrust-mpc** | `https://medtrust-mpc.fly.dev` | HTTP REST | healthy | MP-SPDZ shamir 协议 |
| **medtrust-fl** | `medtrust-fl.fly.dev` | gRPC | checks passing | Flower SuperLink 联邦聚合 |
| **medtrust-connector-a** | `medtrust-connector-a.fly.dev` | gRPC + WS | checks passing | 华山医院 Local Agent（torch + FedAvg） |
| **medtrust-connector-b** | `medtrust-connector-b.fly.dev` | gRPC + WS | checks passing | 瑞金医院 Local Agent |
| **medtrust-vault** | `https://medtrust-vault.fly.dev` | HTTP REST | healthy | 密钥管理 |
| **medtrust-web** | `https://medtrust-web.fly.dev` | HTTP | online | 用户控制台 |

**已植入种子数据**（CKD 场景 `ckd-scenario.json` 已自动加载）：
- 6 个数据产品（CKD 结构化随访、DKD 队列、肾活检病理 WSI、肾脏超声、肾内科文本、用药结局）
- 3 份数字合约（华山→恒瑞、瑞金→医研数据研究院、华山→智慧医疗AI）
- 6 条审计日志
- 演示账号：`admin@huashan-hospital.com` / `demo123456`（role=provider）

---

## Demo 7 步流程

### Step 1 — 服务健康验证（30s）

验证全部 8 个服务在线，采集关键指标。

```bash
scripts/test/real-demo/setup.sh --health
```

**检查项**：
- API：`GET /api/v1/health` → 返回 blockchain/mp-spdz 状态
- Chain：`GET https://medtrust-chain.fly.dev/health` → `{"status":"ok","blockNumber":N}`
- MPC：`GET https://medtrust-mpc.fly.dev/health` → `{"protocol":"shamir","status":"healthy"}`
- FL/Connector-A/Connector-B：通过 `flyctl status` 确认 checks passing
- Vault：`GET /v1/sys/health`
- Web：`GET /` → HTTP 200

### Step 2 — 数据上架（数据提供方视角）

华山医院/瑞金医院/中山医院将 CKD 相关数据资产注册到目录。

**API 调用**（已完成——种子数据自动加载）：
```
GET /api/v1/catalog → 返回 6 个数据产品
GET /api/v1/catalog/:id → 查看单个产品详情（schema、字段、分级分类）
```

**展示要点**：
- 6 个数据产品涵盖结构化 EHR、DICOM 影像、临床文本三种模态
- 每个产品有完整 FHIR schema、分级分类（二级重要数据/三级敏感影像）、使用条款
- 数据记录量：总计 56.6 万条（184,300 + 151,220 + 12,640 + 46,800 + 98,300 + 73,200）

### Step 3 — 交易规则设置（数字合约）

数据消费方（恒瑞医药）发起使用申请，平台创建数字合约，定义使用目的、留存策略、输出限制。

**API 调用**：
```
POST /api/v1/contracts
{
  "dataProductId": "dp-insulin-panc-huashan",
  "providerId": "华山医院",
  "consumerId": "恒瑞医药",
  "purpose": "胰岛素暴露·胰腺炎信号演示研究",
  "retention": "阅后即焚",
  "output": "仅聚合统计"
}
→ 返回 contract id，状态 active，SM3 哈希链上可查
GET  /api/v1/contracts → 查看所有合约
POST /api/v1/blockchain/attest → 将合约哈希上链存证
```

**链上存证验证**：
```
POST /api/v1/blockchain/verify → 验证合约哈希未被篡改
GET  https://medtrust-chain.fly.dev/block-number → 确认区块高度递增
```

### Step 4 — 联邦学习任务创建与派发

恒瑞医药发起 CKD 进展预测的联邦微调任务。

**API 调用**：
```
POST /api/v1/tasks
{
  "name": "CKD 进展预测 · 多模态联邦微调",
  "method": "fl",
  "contractId": "<contract-id>",
  "spec": { ... }  // SecretFlow task spec from ckd-scenario.json
}
```

**gRPC 派发**（API → Connector-A/B）：
```
API orchestrator 通过 gRPC 调用：
  Connector-A（华山医院）：SubmitFLTask(task_id, spec_yaml, node_plan)
  Connector-B（瑞金医院）：SubmitFLTask(task_id, spec_yaml, node_plan)
→ 返回 ack_status="ACCEPTED" + WebSocket log stream URL
```

**WebSocket 实时监控**：
```
ws://medtrust-connector-a.fly.dev/logs/{task_id}
→ 流式返回训练进度：epoch、loss、参与方状态
```

### Step 5 — 联邦训练执行

每个 Connector 本地执行真实 FedAvg 训练。

**Connector 能力**（`apps/agent/src/medtrust_agent/fed_trainer.py`）：
- 真实 PyTorch FedAvg：每轮各 party 本地 SGD → LoRA adapter delta 聚合
- 差分隐私：L2 clip + Gaussian noise（`dp_sgd`）
- 同态加密模拟：additive secret-sharing mask（`heu_enabled`）
- 贡献度计算：数据量 × 实际参与轮次 → 驱动结算
- 输出闸门：仅允许 LoRA delta hash / 加密 delta ref / 聚合指标出域

**监控端**：
```
gRPC: GetTaskResult(task_id) → rounds_completed, metrics_json, lora_delta_hash
gRPC: ReportNodeStatus(task_id) → 流式返回每轮 epoch/loss/phase
WS:   ws://.../logs/{task_id} → 实时文本日志
```

### Step 6 — 模型链上存证

训练完成后，将模型指纹、参与方签名、隐私预算消耗上链。

**API 调用**：
```
POST /api/v1/blockchain/attest
{
  "attestation_type": "model",
  "data_id": "model-ckd-fed-v1",
  "data": "<lora_delta_hash>",
  "metadata": {
    "participants": ["华山医院", "瑞金医院"],
    "rounds": 5,
    "auc_roc": 0.87,
    "dp_epsilon_consumed": 4.0
  }
}
→ 确认状态: confirmed, 链上 tx_hash + block_number
```

**验证**：
```
POST /api/v1/blockchain/verify → 验证模型哈希未被篡改
GET  /api/v1/blockchain/attestations → 查看所有链上存证
```

### Step 7 — 按贡献结算 + 审计

平台根据各参与方的数据量 × 实际参与轮次，自动计算贡献份额并生成结算单。

**结算计算**（Connector 返回的 `contributions` 字段）：
```
恒瑞医药（消费方）支付：¥96
├── 华山医院（29 份额）：¥58 (60.4%)
└── 瑞金医院（19 份额）：¥38 (39.6%)

贡献公式：contribution = Σ(数据记录数 × 有效参与轮次) / 总贡献
```

**API 调用**：
```
GET /api/v1/settlements → 查看结算记录
GET /api/v1/settlements/:id → 查看结算详情（分摊明细、链上哈希）
GET /api/v1/audit → 全流程审计日志（LOGIN→READ→APPROVE→COMPUTE→DOWNLOAD）
```

**审计覆盖**：
- 数据访问（谁、何时、查看了哪个数据产品）
- 合约操作（创建、审批、链上存证）
- 计算执行（任务创建、派发、完成、输出闸门判定）
- 结算事件（金额、份额、链上哈希）

---

## 实施文件

| 文件 | 用途 |
|------|------|
| `scripts/test/real-demo/setup.sh` | 环境准备：健康检查 + Token 获取 + 变量初始化 |
| `scripts/test/real-demo/step2-catalog.sh` | Step 2: 数据上架验证 |
| `scripts/test/real-demo/step3-contract.sh` | Step 3: 合约创建 + 链上存证 |
| `scripts/test/real-demo/step4-task.sh` | Step 4: FL 任务创建与 gRPC 派发 |
| `scripts/test/real-demo/step5-training.sh` | Step 5: 联邦训练监控（gRPC + WS） |
| `scripts/test/real-demo/step6-attest.sh` | Step 6: 模型链上存证 |
| `scripts/test/real-demo/step7-settlement.sh` | Step 7: 结算 + 审计 |
| `scripts/test/real-demo/run-all.sh` | 一键执行全流程 |
| `scripts/test/real-demo/lib/grpc-client.py` | Python gRPC 客户端（连接 Connector） |

---

## 与 mock demo 的关键区别

| 维度 | mock demo（test-flow.sh） | 真实服务 demo |
|------|--------------------------|---------------|
| 认证 | 无认证（开放 mock 接口） | JWT Bearer token |
| 数据目录 | 2 条 mock 数据 | 6 条真实种子数据（含 FHIR schema） |
| 合约 | mock POST → 返回随机 ID | 真实 TypeORM + 链上 SM3 哈希 |
| 存证 | mock `POST /api/v1/chain/attest` | 真实 ChainMaker `POST /attest` |
| FL 训练 | mock `GET /api/v1/fl/status` | 真实 Flower SuperLink gRPC |
| Connector | mock `GET /api/v1/connector/tasks` | 真实 Python Agent gRPC（FedAvg + DP + HEU） |
| 结算 | mock 固定 ¥15000/62%:38% | 真实按数据量×轮次贡献计算 |
| 审计 | mock 单条记录 | 真实全流程审计日志（6+ 种 action） |
| 可重复执行 | 是（幂等 mock） | 部分操作有副作用（链上区块递增、DB 写入） |

---

## 前置条件

1. 所有 8 个 Fly app 处于 `started` 状态
2. API 环境变量 `CHAIN_SIDECAR_URL=https://medtrust-chain.fly.dev` 已设置
3. 演示账号 `admin@huashan-hospital.com` / `demo123456` 可用
4. 本地安装 `grpcurl` 或 Python `grpcio-tools`（用于 gRPC 连接 Connector）

---

## 注意事项

- **Connector 为 gRPC 服务**，不响应 HTTP。健康检查用 `flyctl status`，交互用 gRPC client。
- **FL Server 为 Flower SuperLink**，gRPC 协议。状态通过 Connector 间接观测。
- **链上存证不可逆**，每次 demo 会递增区块高度。测试用 `data_id` 加时间戳避免重复。
- **数据库为 ephemeral SQLite**（demo 模式），重新部署后种子数据自动恢复。
