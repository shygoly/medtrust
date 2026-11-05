# Phase 3 评审：可对齐假名（跨院同一主体对齐）

> 上游：本变更 `design.md` §10（Phase 3）· `cross-hospital-dedup-incidence` design D4 ·
> `vaccine-effectiveness-tnd` design（AEFI/VE 同一演示口径）· TRUST.md CTL-32 / DOMAIN.md INV-DEID-01
> 结论：**本期采用「医院共管 HMAC-SM3 密钥 + 用途分域 + kid 版本化」**；OPRF 列为升级路径并给出切换判据；
> 可信第三方对齐服务否决。

## 1. 要解决的问题

跨院去重（`rws.dedup-incidence`）与跨院配对（`rws.paired-cohort`）、疫苗监测（SCRI）都需要一个事实：
「这条记录和那条记录是不是同一个自然人」。但在数据不出域 + 去标识化的前提下，**没有任何一方掌握这个事实**：
每家医院只有本院记录，平台不持标识，节点只该看到聚合。

于是需要一个**对齐键**：同一主体在不同医院算出的值相同，不同主体不同，且平台无从反查。
本仓已有两处铺好了接口、但**没有生产派生实现**：

| 位置 | 现状 |
|---|---|
| `industries/med/src/records/internal-record.ts#linkKey` | 字段已存在，注释写「真实场景由空间级加盐摘要得出」，**无实现** |
| `apps/connector/src/mdop/operators/seal.ts#minimalPairingProjection` | 只认 `linkKey`，没有它的记录**不出院**（正确的 fail-closed） |
| `apps/connector/src/demo/run-local-loop.ts:45` | 演示里把 `linkKey` 赋成 `subjectKey` —— **跨院会配对失败**，必须改 |
| `wire-power.ts:78` | 电力包的 `ps_` 假名就是共管 HMAC 密钥（`CONNECTOR_POWER_PSEUDONYM_KEY`，D-CN-8），可复用同一形态 |

## 2. 三个候选方案

### A. OPRF（盲化求值）

客户端盲化标识 → 服务端用密钥求值 → 客户端去盲得到 PRF 输出；两院对同一标识得到同值，服务端学不到输入，
客户端拿不到密钥。

**否决理由（不是"不安全"，而是"本仓验收不了"）**：

1. 需要 prime-order group + hash-to-curve（ristretto255 / P-256 / Ed25519-h2c）。国密体系里 **SM2 曲线不是
   为此设计的标准 OPRF 载体**，自己做映射等于自研密码协议；
2. 连接器是 TS、agent 是 Python，两侧必须**逐字节一致**，还要过常数时间与国密合规审查 —— 仓里没有可复用的
   vetted 实现，写一个"看起来能跑"的 OPRF 比不写更危险；
3. 还有一个容易被忽略的点：**OPRF 不消除枚举风险**。求值方若同时看到对齐后的值，仍可对候选标识空间
   （身份证号可枚举）离线枚举自己的密钥。要真正消除，还得叠加速率限制/审计/离线密钥托管。

→ 记为**升级路径**，切换判据见 §5。

### B. 医院共管 HMAC 密钥（选定）

同一联盟的参与方持有**同一把 ≥32 字节随机密钥**，按用途分域派生：`HMAC-SM3(key, purpose‖normalizedId)`。

- 优点：实现与依赖都是现成的（`hmacSm3Hex` 已在 `apps/connector/src/domain/sm3.ts`，电力包在生产用它）；
  两院同 key + 同 purpose ⇒ 同值，天然可对齐；平台不持钥，节点只见聚合；
- 缺点（必须写清、不能糊过去）：
  - **持钥方可离线枚举**：给定一个真实标识（或可枚举空间如身份证号），任何持钥方都能算出对齐值并与手中数据比对。
    缓解：密钥只发参与本研究的机构、按用途/研究项目一把、轮换留旧键、参与方名单与用钥行为受审计；
  - **密钥一旦泄露，历史链接性永久泄露**（跨院可重算）。这也是它不如 OPRF 的地方，故必须作为
    "参与方之间已存在合约级信任"的延伸来用，而不是把信任面扩大到平台；
  - 轮换会切断新旧数据的链接：靠 `kid` 前缀显式暴露，需要重新对齐时用旧键（keyring）复算，而不是假装同名。

### C. 可信第三方对齐服务（TTP）

把标识交给第三方换 token。**否决**：

1. 第三方成为新的个人信息处理者，等于把"数据不出域"换成"标识出域"，合规义务与叙事同时变差；
2. 单点合谋：拿到 TTP 的密钥或日志即掌握全量链接性，比 B 的"参与方共管"更集中；
3. 多一个在线依赖：TTP 不可用即无法生成投影，与本仓"离线可用性"原则冲突。

## 3. 决策

**采用 B，并把形状钉死如下（实现见 `packages/mdop/src/alignment/`）：**

| 项 | 口径 |
|---|---|
| 派生式 | `lk_<kid>_<HMAC-SM3(key, "medtrust.alignment.v1\n" + purpose + "\n" + normalizedId)[:32]>` |
| `kid` | `SM3("medtrust.alignment.kid.v1\n" + purpose + "\n" + key)[:16]` —— 自描述、按用途隔离、轮换可见 |
| `purpose` | 研究/场景域（如 `dedup-incidence:ckd-2026`）；**不同用途必须不同值**（防跨项目链接） |
| 规范化 | 派生**之前**统一：trim、删空格/连字符、16 位身份证尾 `x→X`；未规范化 = 同一人两院两个值 |
| 密钥 | ≥32 字符随机值；放医院 Vault/KMS，连接器启动加载（env 或 0600 文件）；**平台不持、不进节点** |
| 缺条件 | 无 key / 无标识 / 标识非法 → **不产生 linkKey**（该记录不出院），**不得回退到 `subjectKey`** |
| 审计 | 记 `alignment-derive` 事件（计数 + kid + purpose），**不记标识本身** |

**派生发生在连接器（标识仍在的边界），不在 agent。** 理由：agent 的算子集是封闭的（DeidSpec v1 九个算子），
加一个 `alignment_pseudonym` 要走规格 v2 + proto 变更；而且对齐键属于"出域前的一道键控变换"，
由持数据源权限、持密钥引用的连接器做最自然。agent 只做去标识（subjectKey 那一侧）。

## 4. 在 C1/C2 链路里的位置

```
院内记录（含真实标识）
   │  ① 去标识：subjectKey（院内盐，各院不同）        ← agent / builtin
   │  ② 对齐：linkKey（共管钥 + purpose）             ← 连接器，本评审新增
   ▼
LocalStore（subjectKey + linkKey + 去标识临床字段）
   │  ③ seal：最小投影 {linkKey, ageBand, sex, observation, events…}
   ▼
C1 密文信封 ──▶ C2 节点（按 linkKey 求并集/交集/去重）──▶ C3 聚合（过 minCell 闸门）
```

- **C1 之前**不出现任何跨院可比的键值（`subjectKey` 各院不同，拿它配对交集恒为空 —— 这正是当前 demo 的错误）；
- **C2 节点**只见 `linkKey` 与白名单编码，不见 `subjectKey`、不见标识；
- **平台**只见 C3 聚合与回执摘要：`linkKey` 永不上报。

## 5. 升级到 OPRF 的判据（不是"以后再优化"这种空话）

同时满足下列四条才切换，否则继续用 B：

1. 有 vetted 的 OPRF 实现（SM2 曲线外的标准群，如 ristretto255），且 TS 与 Python 两侧对拍逐字节一致；
2. 通过常数时间与国密合规审查（或在监管口径上被明确接受）；
3. 求值服务**不由平台运营**（否则等于把合谋面搬到平台）；
4. 迁移方案：旧 `lk_` 值与新 OPRF 值的桥接（一次性重算，需旧键）与历史数据处置写清。

## 6. 验收判据（本评审落地的机检项）

- [x] 同一 `normalizedId` + 同一 `purpose` + 同一 key → 跨院派生值**完全相同**（`alignment.spec.ts`）
- [x] 不同 `purpose` → 值不同（防跨项目链接）
- [x] 轮换后：新值带新 `kid`，旧库可用 keyring 里的旧键复算得到旧值（**不假装同名**）
- [x] 无 key / 空标识 / 非法标识 → 抛错且**不产生**任何值（fail-closed）
- [x] 规范化：`空 格/连字符/小写 x` 与规范形态派生出同一个值
- [x] 缺 `linkKey` 的记录在 `seal` 阶段被过滤（既有行为，回归锁定）
- [ ] 各院投影构造器（dedup / paired / scri）改用 `linkKey` 派生（**待接入**：见 tasks.md）

## 7. 明确不做

- 不做 `linkKey` 的跨院碰撞/断裂的个体级影响评估（dedup 变更已列为另立项）；
- 不宣称 `linkKey` 达到匿名化：它是**可控的链接性**，链接范围被 purpose 与持钥方名单限制；
- 不把密钥托管做成"平台代管"（那就退化成 C 方案的安全性问题）。
