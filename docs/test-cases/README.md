# 手测用例总册 · 医疗空间 & 电力空间

> **用法**：每个用例都是「前置 → 步骤 → 预期 → 记录」四段式，可独立执行。执行时把「记录」列填成
> `通过 / 失败 / 备注` 即可交付。用例编号：`M-*` 医疗、`P-*` 电力。
>
> **口径来源（不凭印象写）**：路由与标签取自 `apps/web/src/nav.manifest.json`；接口取自各 controller；
> 判定与拒绝码取自领域代码（每条用例末尾都标了对应代码位置，便于代码变了同步改用例）。
>
> **与既有文档的关系**：[REAL_DEMO_GUIDE.md](../REAL_DEMO_GUIDE.md)（医疗演示叙述版 8 步）、
> [docs/demo/federated-e2e-test.md](../demo/federated-e2e-test.md)（Fly 上的 FL/LoRA 端到端，
> 路由为旧 IA）——本册是**可勾选的测试用例版**，路由按新 IA。

---

## 0. 环境准备（先做 E1–E6）

### 0.1 本机（推荐；也可对 ali29 生产执行，把地址换成生产域名）

| # | 步骤 | 预期 |
|---|---|---|
| E1 | `pnpm install` | 无错 |
| E2 | `pnpm check:runtime` | Node 20 + `better-sqlite3` 真实 dlopen 通过 |
| E3 | `pnpm dev` | web `:5020`、api `:5021`；`http://127.0.0.1:5021/api/docs` 可打开 |
| E4 | 打开 `http://127.0.0.1:5020/login` | 登录页出现演示账号快捷按钮 |
| E5 | 健康检查 `GET /api/v1/health` | 200 |
| E6 | `node scripts/check-orchestration.mjs` | `0 error(s)`（编排迁移台账与守护自检；M-16 会用到） |

### 0.2 电力空间需要显式授权（否则电力用例全部跳过）

电力包**不在缺省白名单**：`SPACE_PACKS` 缺省 `med`（[DEPLOY.md §2](../DEPLOY.md) 第 218 行）。

| # | 步骤 | 预期 |
|---|---|---|
| E7 | 在 `apps/api/.env` 增加一行 `SPACE_PACKS=med,power` | 保存 |
| E8 | 重启 api（`pnpm --filter api dev`） | 日志出现「**电力空间 hn-power 已就绪**」 |
| E9 | 确认 `SEED_DEMO_USERS` 不是 `false`（非生产缺省 seed） | 电力 9 家机构账号被创建（见 §0.4） |
| E10 | `GET /api/v1/health` 后再看日志 | 无「电力包不在部署白名单内」字样 |

> 若 E8 日志是「电力包不在部署白名单内，不创建电力空间」→ E7 没生效（env 文件位置不对或没重启）。

### 0.3 账号（密码统一 `demo123456`）

医疗空间（9 个演示账号由部署侧种子提供；本机若缺账号见 M-18 的种子说明）：

| 角色 | 机构 | 账号 |
|---|---|---|
| 提供方 | 示范甲医院 | `admin@demohospa-hospital.com` |
| 提供方 | 示范乙医院 | `admin@demohospb-hospital.com` |
| 使用方 | 创新药企 | `pv@demo-pharma.example` |
| 使用方 | 医科大数据研究院 | `research@meddata-inst.edu.cn` |
| 监管方 | 区域卫健委 | `data-governance@health.gov.cn` |
| 合规方 | 合规审查官 | `compliance@medtrust.org` |
| 提供方（备用） | 华山医院 / 瑞金医院 | `admin@huashan-hospital.com` / `admin@rjh.com.cn` |

电力空间（来源 `industries/power/src/scenarios.ts` 的 `POWER_DEMO_USERS`）：

| 机构 | participantId | 账号 | 参与协作 |
|---|---|---|---|
| 省级电网公司 | `p-grid-hn` | `grid@hn-power.example` | 三个协作全部 |
| 气象部门 | `p-weather-hn` | `weather@hn-power.example` | urban-anomaly |
| 市政排水与城管 | `p-civic-hn` | `civic@hn-power.example` | urban-anomaly |
| 政务数据主管部门 | `p-gov-hn` | `gov@hn-power.example` | urban-anomaly |
| 新能源场站运营商 | `p-res-hn` | `plant@hn-power.example` | renewable-absorption |
| 电力交易中心 | `p-market-hn` | `market@hn-power.example` | renewable-absorption |
| 车辆制造商 | `p-ev-oem-hn` | `oem@hn-power.example` | v2g-coordination |
| 车网聚合商 | `p-ev-agg-hn` | `agg@hn-power.example` | v2g-coordination |
| 充电运营商 | `p-charge-hn` | `charge@hn-power.example` | v2g-coordination |

### 0.4 空间与切换

| 空间 | id | 说明 |
|---|---|---|
| 默认（医疗） | 见 `packages/demo-scenario` 的 `SPACE_ID` | 医疗目录、合约、RWS/FL 任务都在这里 |
| 河南电力可信数据空间 | `hn-power` | 需 E7 授权后存在；另有 3 个协作 |

切换：左侧导航顶部的**空间切换器**（`space-switcher`）。切换后菜单与数据都按空间隔离——电力用例必须在电力空间下执行。

### 0.5 取 JWT（API 用例用）

```bash
API=http://127.0.0.1:5021/api/v1
TOKEN=$(curl -s $API/auth/login -H 'content-type: application/json' \
  -d '{"account":"grid@hn-power.example","password":"demo123456"}' | jq -r .access_token)
curl -s $API/health -H "authorization: Bearer $TOKEN"
# 登录：字段是 account（不是 email）；token 字段是 **access_token**（snake_case，2026-10-13 实测）。
# 响应还带 user.spaceId / user.spaces（当前空间与可加入空间）。
# ⚠️ /auth/login 有节流：连打几次会 429。多角色用例之间请间隔 ~40-75 秒，或复用同一 token。
```

### 0.6 记录约定

| 列 | 填法 |
|---|---|
| 结果 | `通过` / `失败` / `跳过（原因）` |
| 证据 | 截图名、任务 id、attempt id、返回体片段 |
| 备注 | 与用例不符之处（**这是最有价值的产出**：文档与实现不一致，以代码为准并回填本册） |

---

## 用例索引

| 分册 | 覆盖 |
|---|---|
| [medical.md](./medical.md) | M-01…M-18：登录/RBAC、空间、目录、合约、RWS 阶梯（含 **L1.5 单通道切换验收**）、MDOP 原生四模板、通用入口归属、L4 联邦预测、LoRA FedAvg、结算/存证/审计/RBQM、**编排迁移台账守护自检**、无 GUI 的 CLI 链路、AMR 哨兵 |
| [power.md](./power.md) | P-01…P-14：电力包授权与种子、空间切换、三协作与目录、合约、**交换尝试 1 成功 + 7 类拒绝**、合并点改写与禁止明文、记录与审计、负例（未授权包） |

> 建议顺序：E1–E10 → M-01…M-18 → P-01…P-14。P 系列依赖 E7 授权。

---

## 执行记录（2026-10-13 自测，本机）

| 范围 | 结果 |
|---|---|
| M-16 守护自检 | ✅ 通过（基线 `0 error`；注入 `legacyBudget+1` → `[ERR] legacyBudget 上升：9 -> 10`；撤销恢复；负例 **24/24**） |
| M-17 CLI | ✅ **9/9 通过**：`demo`（40 例入域脱敏 + 出域原始行 0）· `demo:amr-q1/q2/q3/q4`（四个 AMR 问题各自 PASS）· `demo:he`（「解密结果 = 各院明文逐项之和 ✓」）· `demo:cross` · `demo:e2e`（exit 0）· `demo:synthea-e2e`（两院「外部读行级数据：已拒绝 ✓」） |
| P-01 电力包授权与种子 | ✅ 通过（日志「电力空间 hn-power 已就绪」；健康 200；0 致命错） |
| P-02 电力账号 | ✅ 通过（`grid@hn-power.example` / `demo123456` 可登录） |
| P-07 拒绝 `no-contract` | ✅ 通过（**201** + `{"rejection":"no-contract","spaceId":"hn-power","contractId":null}`） |
| 400 对照（缺 `applicationId`） | ✅ 通过（`400 {"message":"缺少应用"}`） |
| P-06 非成员 | ✅ 通过，但**预期修正为 403**（`SpaceAccessGuard` 先挡），不是 `rejection:"not-space-member"` |
| P-08 `not-contract-party` | ✅ 通过（201 + `{"rejection":"not-contract-party"}`，合约 C1 = `e9fedfc2…`） |
| P-09 `not-collaboration-member` | ✅ 通过（201 + 该码；**前置已修正**：合约必须覆盖该应用所属场景，且消费方在该协作之外，合约 C3 = `14f27e20…`） |
| P-10① `operator-digest-missing` | ✅ 通过（201 + 该码） |
| P-10② `operator-digest-unregistered` | ✅ 通过（201 + 该码，64 位 hex 但未登记） |
| P-13 记录与审计 | ✅ 通过（`cp_exchange_attempt` 表结构仅 `contractId/mergePoint/outputHash/rejection/createdAt/space_id`——**无曲线/凭证/明细**；按 rejection 可分组审计） |
| P-05 交换成功 | ⛔ **结构上不可达**：电力包 `declareOperators()` 返回 `[]` → 无已登记算子摘要 → 任何摘要都落 `unregistered`。需先让电力包声明真实算子并登记摘要 |
| P-11 `forbidden-output` / P-12 合并点改写 | ⛔ **不可达**：`admitExchange` 里摘要校验在禁止输出/合并点**之前** —— 实测「合法 digest + 禁止字段」仍返回 `operator-digest-unregistered` |
| P-14 | ⛔ 未执行：需干净库（本机库已写入 `hn-power`） |
| M-01…M-15（GUI） | ⛔ 本机无医疗账号（实测；另注意登录限流 429）⇒ 建议在 **ali29** 执行 |

### 自测发现的两个必修项

1. **api 起不来（已修复）**：演示合约种子引用本机 catalog 里不存在的 `dp-ckd-imaging` / `dp-ckd-lab` →
   `ContractService.onModuleInit` 抛 `数据产品不存在` → **整个 API 崩溃**（`:5021` down，web/connector 仍在）。
   已做两层修复：① **韧性**（单条种子失败只告警跳过）；② **根因**——查 git 历史确认这三条（`dp-ckd-imaging`×2、`dp-ckd-lab`）
   是 2026-06-20 `1f5f71a` 引入的**旧 demo 世界**产品（当时还用中文机构名），机构 id 迁移时被漏掉，
   而现役场景里 **provider 侧根本没有对应产品**，永远建不成 → 已**删除这三条死种子**。
   修复后：`[seed]` 告警 **3 → 0**，启动成功，digital-contract **87 tests / 7 suites** 全绿。
2. **登录限流**：`/auth/login` 连续请求会 **429**。批量跑用例时登录一次、复用 token（§0.5 的写法即复用）。

> 逐条修正见 [power.md](./power.md) 文首「执行记录」与 [medical.md](./medical.md) 末尾「执行记录」。
