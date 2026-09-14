# RWS Analytics Ladder — Fly.io 四场景端到端测试

> **环境：** Production Fly（`medtrust-api` + 四连接器）  
> **密码：** 所有演示账号 `demo123456`  
> **预计耗时：** 单场景 30–90 秒（含 worker 出站轮询）；四场景串行约 5–8 分钟

## 架构与在线地址

| 组件 | Fly App | 公网地址 | 角色 |
|------|---------|----------|------|
| 控制面 API | `medtrust-api` | https://medtrust-api.fly.dev/api/v1 | 任务编排、合约、meta 合并 |
| Web 控制台 | `medtrust-web` | https://medtrust-web.fly.dev | 可选 UI 验收 |
| RWS Worker 华山 | `medtrust-rws-worker-a` | https://medtrust-rws-worker-a.fly.dev/health | NestJS，L1.5–L3 + L4 出站轮询（`p-huashan`） |
| RWS Worker 瑞金 | `medtrust-rws-worker-b` | https://medtrust-rws-worker-b.fly.dev/health | NestJS，L1.5–L3 + L4 出站轮询（`p-ruijin`） |
| Python Agent 华山 | `medtrust-connector-a` | gRPC `:5024`（无 HTTP `/`） | L3/L4 重计算 / SecretFlow（`fly status` 看 checks） |
| Python Agent 瑞金 | `medtrust-connector-b` | gRPC `:5024` | 同上 |
| 区块链存证 | `medtrust-chain` | https://medtrust-chain.fly.dev/health | L4 `model_hash` 存证（可选） |

数据流（模式 A，L1.5–L3）：

```
消费方 POST /rws/tasks
  → medtrust-api 入队
  → medtrust-rws-worker-{a,b} 轮询 GET /connector/rws/pending
  → 本地 TEE 计算 + 输出闸门
  → POST /connector/rws/assignments/:id/complete
  → API meta 合并 → GET /rws/tasks/:id
```

数据流（模式 B，L4）：

```
消费方 POST /fl-prediction/tasks
  → worker 轮询 GET /connector/fl-prediction/pending
  → 本地 FL + DP 闸门
  → API FedAvg 合并 + SM3 存证
  → GET /fl-prediction/tasks/:id
```

## 演示账号

| 角色 | 邮箱 | participantId | 用途 |
|------|------|---------------|------|
| 数据消费方 | `research@meddata-inst.edu.cn` | `p-meddata` | 发起 RWS / FL 任务 |
| 创新药企 PV（别名匹配） | `pv@demo-pharma.example` | `pharma-demo` | 等同 `p-meddata` 合约侧 |
| 华山提供方 | `admin@huashan-hospital.com` | `p-huashan` | 审批合约 draft |
| 瑞金提供方 | `admin@rjh.com.cn` | `p-ruijin` | 审批合约 draft |

## 阶段 0 — 前置检查

### 0.1 健康检查

```bash
curl -sf https://medtrust-api.fly.dev/api/v1/health | jq '.status'
curl -sf https://medtrust-rws-worker-a.fly.dev/health
curl -sf https://medtrust-rws-worker-b.fly.dev/health
fly status -a medtrust-connector-a | head -12
fly status -a medtrust-connector-b | head -12
```

**通过标准：** API `healthy`；两个 RWS worker 返回 `{"ok":true,"service":"medtrust-connector"}`；connector-a/b `checks passing`。

### 0.2 登录获取 JWT

```bash
export API=https://medtrust-api.fly.dev/api/v1
export JWT=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"research@meddata-inst.edu.cn","password":"demo123456"}' \
  | jq -r '.access_token')
echo "JWT=${JWT:0:20}..."
```

### 0.3 数字合约（华山 + 瑞金）

> **v4 起：华山 + 瑞金合约均已种子化，`CONTRACT_RUIJIN` 无需手工创建。**
> 华山 `seed:dp-insulin-panc-huashan:...`、瑞金 `seed:dp-insulin-panc-ruijin:p-meddata:胰岛素暴露·胰腺炎信号演示研究`
> 在 `contract.service.ts` onModuleInit 幂等种子中，重部署后稳定复现。下方手工申请+审批流程
> 仅作备用（如需自定义合约）。此前瑞金合约只作为一次性 UUID 存在，Fly ephemeral 库重部署即被
> 清空，导致 FL L4 admission 报 `存在无效的数字合约引用`(403)。

Fly 种子合约中华山 `dp-insulin-panc-huashan` 已 active；瑞金须使用目录中真实存在的 **`dp-insulin-panc-ruijin`**（勿用 `dp-ckd-imaging`，catalog 无此 ID）。

华山（已存在）：

```
seed:dp-insulin-panc-huashan:p-meddata:胰岛素暴露·胰腺炎信号演示研究
```

瑞金（若不存在则申请 + 审批）：

```bash
# 消费方申请
curl -s -X POST "$API/contracts/requests" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{
    "dataProductId": "dp-insulin-panc-ruijin",
    "purpose": "胰岛素暴露·胰腺炎信号演示研究",
    "retention": "阅后即焚",
    "output": "仅聚合统计",
    "validDays": 90
  }' | jq '{id, status, dataProductId}'

# 瑞金医院审批（将 <DRAFT_ID> 替换为上一步 id）
export PROV_JWT=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@rjh.com.cn","password":"demo123456"}' | jq -r '.access_token')

curl -s -X POST "$API/contracts/<DRAFT_ID>/approve" \
  -H "Authorization: Bearer $PROV_JWT" | jq '{id, status, hash}'
```

测试用环境变量：

```bash
export CONTRACT_HUASHAN='seed:dp-insulin-panc-huashan:p-meddata:胰岛素暴露·胰腺炎信号演示研究'
export CONTRACT_RUIJIN='<DRAFT_ID 或已有 active 合约 id>'
export PURPOSE='胰岛素暴露·胰腺炎信号演示研究'
```

### 0.4 连接器目录预检（可选）

```bash
export CONNECTOR_TOKEN=dev-connector-token

curl -sf "$API/connector/catalog/dp-insulin-panc-huashan" \
  -H "X-Connector-Token: $CONNECTOR_TOKEN" \
  -H "X-Connector-Participant: p-huashan" | jq '.id,.recordCount'

curl -sf "$API/connector/catalog/dp-insulin-panc-ruijin" \
  -H "X-Connector-Token: $CONNECTOR_TOKEN" \
  -H "X-Connector-Participant: p-ruijin" | jq '.id,.recordCount'
```

---

## 场景 1 — L1.5 失衡信号（disproportionality）

**Spec：** `rws-compute` →「L1.5 失衡信号仅出列联表」  
**参与方：** 华山 + 瑞金  
**Worker：** `medtrust-rws-worker-a` + `medtrust-rws-worker-b`

### 1.1 发起任务

```bash
curl -s -X POST "$API/rws/tasks" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{
    \"title\": \"fly-e2e L1.5 失衡信号\",
    \"purpose\": \"$PURPOSE\",
    \"analysis\": {
      \"type\": \"disproportionality\",
      \"level\": \"L1.5\",
      \"drug\": \"二甲双胍\",
      \"allowedArtifacts\": [\"disproportionality\"]
    },
    \"contractIds\": [\"$CONTRACT_HUASHAN\", \"$CONTRACT_RUIJIN\"]
  }" | tee /tmp/l15-task.json | jq '{taskId, status, assignments: [.assignments[] | {providerId, status}]}'
```

记录 `taskId`：

```bash
export TASK_L15=$(jq -r '.taskId' /tmp/l15-task.json)
```

### 1.2 轮询完成（worker 自动执行，无需手动 pull）

```bash
for i in $(seq 1 18); do
  sleep 5
  curl -s "$API/rws/tasks/$TASK_L15" -H "Authorization: Bearer $JWT" \
    | jq '{status, merged: {cohortSize, analysisType, buckets: (.merged.buckets|length)}, assignments: [.assignments[]|{providerId,status,error}]}'
done
```

### 1.3 通过标准

| 检查项 | 期望 |
|--------|------|
| `status` | `completed`（双院成功）或 `partial`（单院成功时检查 `error`） |
| `merged.analysisType` | `disproportionality` |
| `merged.cohortSize` | `> 0` |
| 响应 JSON | **不含** `subjectKey`、患者 ID 等行级字段 |
| 华山 assignment | `progress` 含 `pep-check` → `output-gate` → `complete` |
| Worker 日志 | `fly logs -a medtrust-rws-worker-a --no-tail \| tail -20` 无 DI 崩溃 |

---

## 场景 2 — L2 比较效应（comparative-effect）

**Spec：**「L2 比较仅出效应量」+ meta 合并 pooled OR  
**模式：** A（单发站点 β + 中心 meta）

### 2.1 发起任务

```bash
curl -s -X POST "$API/rws/tasks" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{
    \"title\": \"fly-e2e L2 比较效应\",
    \"purpose\": \"$PURPOSE\",
    \"analysis\": {
      \"type\": \"comparative-effect\",
      \"level\": \"L2\",
      \"drug\": \"二甲双胍\",
      \"outcome\": \"Chronic kidney disease stage 3\",
      \"outcomeKind\": \"condition\",
      \"allowedArtifacts\": [\"effect_estimate\", \"meta_pooled\"]
    },
    \"contractIds\": [\"$CONTRACT_HUASHAN\", \"$CONTRACT_RUIJIN\"]
  }" | tee /tmp/l2-task.json | jq '{taskId, status}'
```

```bash
export TASK_L2=$(jq -r '.taskId' /tmp/l2-task.json)
```

### 2.2 轮询

```bash
for i in $(seq 1 18); do sleep 5; curl -s "$API/rws/tasks/$TASK_L2" \
  -H "Authorization: Bearer $JWT" \
  | jq '{status, meta: .merged.metaPooled, effect: .assignments[0].aggregate.effectEstimate.measure}'; done
```

### 2.3 通过标准

| 检查项 | 期望 |
|--------|------|
| 各站 `aggregate.effectEstimate.beta` | 存在（可为 0） |
| `merged.metaPooled.merged` | `true`（双院完成时） |
| `merged.metaPooled.pooledOr` | 有限正数 |
| `attestation.txHash` | 顶层字段（与 `merged.metaPooled.attestation` 一致） |
| 无行级泄露 | JSON 无 `subjectKey` |

---

## 场景 3 — L3 因果生存（causal-survival + TTE）

**Spec：**「L3 因果仅出站点效应量」+ Cox HR meta  
**Worker：** NestJS Echo 因果后端（生产可切 Python agent `medtrust-connector-a.internal:5024`）

### 3.1 发起任务

```bash
curl -s -X POST "$API/rws/tasks" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{
    \"title\": \"fly-e2e L3 因果生存\",
    \"purpose\": \"$PURPOSE\",
    \"analysis\": {
      \"type\": \"causal-survival\",
      \"level\": \"L3\",
      \"method\": \"cox\",
      \"tte\": {
        \"exposureArm\": \"drug:二甲双胍\",
        \"comparatorArm\": \"drug:胰岛素\",
        \"timeZeroRule\": \"index_date\",
        \"inclusion\": [\"age>=18\"],
        \"exclusion\": [],
        \"outcome\": { \"type\": \"time_to_event\", \"event\": \"renal_failure\" }
      },
      \"allowedArtifacts\": [\"hazard_ratio\", \"km_curve\", \"meta_pooled\"]
    },
    \"contractIds\": [\"$CONTRACT_HUASHAN\", \"$CONTRACT_RUIJIN\"]
  }" | tee /tmp/l3-task.json | jq '{taskId, status}'
```

```bash
export TASK_L3=$(jq -r '.taskId' /tmp/l3-task.json)
```

### 3.2 轮询

```bash
for i in $(seq 1 24); do sleep 5; curl -s "$API/rws/tasks/$TASK_L3" \
  -H "Authorization: Bearer $JWT" \
  | jq '{status, hr: .merged.metaPooled.pooledHr, km: (.merged.kmCurve.bins|length?)}'; done
```

### 3.3 通过标准

| 检查项 | 期望 |
|--------|------|
| `aggregate.effectEstimate.measure` | `log_hr` |
| `merged.metaPooled.pooledHr` | 双院完成时出现 |
| `kmCurve.bins` | 分箱数组，非个体时间点 |
| 闸门 | 末段 `atRisk` 低于阈值时被抑制 |

---

## 场景 4 — L4 联邦预测（CKD ESRD 风险）

**Spec：**「模式 B 多轮仅交换聚合量」+ DP + `model_hash` 存证  
**合约：** 华山 `dp-insulin-panc-huashan` + 瑞金 `dp-insulin-panc-ruijin`（**与 flPredictionSpec.parties 一致**）

### 4.1 发起任务

```bash
curl -s -X POST "$API/fl-prediction/tasks" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{
    \"title\": \"fly-e2e L4 CKD ESRD\",
    \"contractIds\": [\"$CONTRACT_HUASHAN\", \"$CONTRACT_RUIJIN\"],
    \"flPredictionSpec\": {
      \"purpose\": \"$PURPOSE\",
      \"federationMode\": \"horizontal\",
      \"modality\": \"structured_ehr\",
      \"parties\": [
        {\"participantId\":\"p-huashan\",\"role\":\"provider\",\"dataProductId\":\"dp-insulin-panc-huashan\",\"connectorId\":\"cn-huashan\"},
        {\"participantId\":\"p-ruijin\",\"role\":\"provider\",\"dataProductId\":\"dp-insulin-panc-ruijin\",\"connectorId\":\"cn-ruijin\"},
        {\"participantId\":\"p-meddata\",\"role\":\"consumer\",\"dataProductId\":\"\"}
      ],
      \"modelType\": \"xgboost\",
      \"objective\": \"binary\",
      \"targetColumn\": \"esrd_event\",
      \"featureColumns\": [
        {\"name\":\"egfr\",\"dtype\":\"numeric\"},
        {\"name\":\"scr\",\"dtype\":\"numeric\"},
        {\"name\":\"uacr\",\"dtype\":\"numeric\"}
      ],
      \"aggregation\": \"secureboost\",
      \"rounds\": 3,
      \"hyperparameters\": {\"maxDepth\": 4, \"learningRate\": 0.1, \"nEstimators\": 50},
      \"privacy\": {\"dpEpsilon\": 4.0, \"dpDelta\": 1e-5, \"minCohortSize\": 5},
      \"outputPolicy\": {
        \"allowedArtifacts\": [\"auc\", \"f1\", \"model_hash\", \"aggregate_metrics\", \"attestation_report\"]
      }
    }
  }" | tee /tmp/l4-task.json | jq '{taskId, status, providers: [.assignments[].providerId]}'
```

```bash
export TASK_L4=$(jq -r '.taskId' /tmp/l4-task.json)
```

### 4.2 轮询

```bash
for i in $(seq 1 24); do sleep 5; curl -s "$API/fl-prediction/tasks/$TASK_L4" \
  -H "Authorization: Bearer $JWT" \
  | jq '{status, auc: .merged.aggregateMetrics.auc, modelHash: .merged.modelHash, attestation: .attestation.chainTxHash, assignments: [.assignments[]|{providerId,status,error}]}'; done
```

### 4.3 通过标准

| 检查项 | 期望 |
|--------|------|
| `status` | `completed` |
| `merged.aggregateMetrics.auc` | `0..1` |
| `merged.modelHash` | 非空 |
| `merged.privacy.dpApplied` | `true`（声明了 ε） |
| `attestation` | 含 `chainTxHash` 或 SM3 报告哈希 |
| 各方 | `dpApplied: true` |

---

## 一键脚本

仓库内可执行脚本（与本文等价，自动轮询 + 断言）：

```bash
cd apps/api
CONTRACT_RUIJIN='<瑞金合约id>' npx ts-node scripts/e2e-analytics-ladder-fly.ts
```

环境变量：

| 变量 | 默认 |
|------|------|
| `CONTROL_PLANE_URL` | `https://medtrust-api.fly.dev/api/v1` |
| `CONTRACT_HUASHAN` | `seed:dp-insulin-panc-huashan:p-meddata:胰岛素暴露·胰腺炎信号演示研究` |
| `CONTRACT_RUIJIN` | **必填**（`dp-insulin-panc-ruijin` 的 active 合约 id） |
| `CONSUMER_EMAIL` | `research@meddata-inst.edu.cn` |
| `POLL_SECONDS` | `90` |
| `LADDER_FULL` | 默认发送完整 `analysis`（含 level/outcome/tte）。仅当目标 API 为旧版（DTO 未含 `outcome`/`tte`）时设 `0` 回退精简 spec；L2/L3 需完整 spec 才能执行 |

---

## 常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| 瑞金 `目录元数据拉取失败: dp-ckd-imaging` | 种子合约产品 ID 与 catalog 不一致 | 改用 `dp-insulin-panc-ruijin` 合约（阶段 0.3） |
| `analysis.property level should not exist` | API 镜像未含扩展 DTO | 重部署 `medtrust-api` 或去掉 `level` 字段 |
| `status=partial` 单院 failed | 对侧 worker 停机 / 合约错误 | `fly machine start` + 查 `fly logs -a medtrust-rws-worker-b` |
| L4 瑞金 failed | `flPredictionSpec` 与合约 `dataProductId` 不一致 | parties 瑞金用 `dp-insulin-panc-ruijin` |
| connector-a HTTP 000 | Python gRPC 服务 | 用 `fly status` 而非 `curl /` |

---

## 与 OpenSpec 场景映射

| OpenSpec Scenario | 本测试 |
|-------------------|--------|
| L1.5 失衡信号仅出列联表 | 场景 1 |
| L2 比较仅出效应量 | 场景 2 |
| L3 因果仅出站点效应量 | 场景 3 |
| 模式 B 多轮仅交换聚合量 | 场景 4 |
