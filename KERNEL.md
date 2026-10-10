# KERNEL.md — 可信空间基座契约

> 基座（TDS Kernel）是所有能力包共享的、**领域中立**的能力层。本册是基座的唯一权威：
> 能力模块清单、六根 SPI、纯度判据。与 [ARCHITECTURE.md](ARCHITECTURE.md) 分工：
> ARCHITECTURE 管分层与部署，本册管**基座与包的边界**。
> 装配与包模板见 [PACK.md](PACK.md)；决策见 [DECISIONS.md](DECISIONS.md) 的 D-SPD-1 … D-SPD-19。
> 冲突时以本册 + 八件套元语为准；发现冲突停下说明，不要悄悄改。

## 1. 三轴与边界

| 轴 | 单元 | 谁决定 | 载体 |
|---|---|---|---|
| 空间 | 每个空间 | `operator` | `cp_space` + 每空间 CA 根 |
| 能力包 | 每个领域 | 平台 / 生态 | 六根 SPI + 打包插件 |
| 分发边界 | 每个可装载单元 | 开源策略 | T0 / T1 / T2 |

依赖方向恒为 **包 → SPI → 基座**。基座 MUST NOT 依赖任何能力包；能力包之间 MUST NOT 互相依赖（D-SPD-1 / D-SPD-6）。

## 2. 九大能力模块（T0 · 必开源）

| # | 模块 | 内容 |
|---|---|---|
| ① | 身份与信任 | SM2 CA · 证书生命周期 · 安全通道 · 平台密钥分离 |
| ② | 目录与合约 | URN 数据产品 · 数字合约 · 使用控制 · PEP |
| ③ | 编排内核 MDOP | 作业 / 阶段 / 片段 · 凭证协商 · 调度 · 销毁 · 回执链 |
| ④ | 流动等级与闸门 | 标签格 · 出域闸门框架 · fail-closed 义务分层 |
| ⑤ | 可信执行 | 零能力沙箱 · 模块准入五道闸 · TEE 节点 · 证明 |
| ⑥ | 存证与审计 | 链上存证 · 结果背书 · 链式审计 · 证据账本 |
| ⑦ | 互联 | URN 联邦 · CA 信任清单 · 跨空间目录 |
| ⑧ | 价值与治理 | **仅接口面**：计量 SPI、质量与估值接入点、分层分级、贡献度分配 |
| ⑨ | 平台底座 | 空间 · 成员 · 认证鉴权 · 开放平台 · 导航契约 |

## 3. 六根 SPI（S1–S6）

接口定义在 `packages/space-kernel-spi`（零依赖纯类型）。**所有签名 MUST 携带空间上下文 `SpiContext`**（D-SPD-2 / D-SPD-10）。

| 缝 | 接口 | 开源要求 | 层 |
|---|---|---|---|
| S1 数据源适配 | `DataSourceAdapter` | 接口与投影语义必开源；实现可在数据持有方侧闭源 | T1 + T2 |
| S2 算子包 | `OperatorPack` | 可闭源（仅 Wasm / OCI + 五道闸） | T2 |
| S3 出域策略 | `EgressPolicyProvider` | **必开源或可审**（决定放行） | T1 |
| S4 计量 / 估值 | `MeteringProvider` | 可闭源；无插件时走开放兜底并**如实标注** | T2 |
| S5 合规配置 | `AssuranceProfile` | **必开源或可审**（监管与客户须能审） | T1 |
| S6 术语与去标识 | `TerminologyDeidentifier` | 去标识代码必开源或可审；词典可许可 | T1 |

## 4. 闭源准入公理（D-SPD-5）

一个环节可以闭源，**当且仅当**：① 不接触原始数据 ② 不决定数据放行与否 ③ 输出可被开源侧独立复核 / 对拍。
违反任一条 → 必须开源或至少可审。

**推论**：基座开源后，闭源挡不住用户绕开；强制只能靠 **许可 + 存证 + 合约条款**——保密只保护 IP，不保证行为。

## 5. 基座纯度判据（可机检）

1. 基座目录内 MUST NOT 出现行业词（按**词元 / camelCase 边界**匹配，禁裸子串）。
2. 基座 MUST NOT import 任何能力包；能力包之间 MUST NOT 互相 import。
3. MUST 具备双能力包装配测试（同时装载两个领域包）。

守护：`node scripts/check-kernel-purity.mjs`（`--baseline` 为 P0 基线模式）；负例自检 `scripts/check-kernel-purity.test.mjs`。
denylist 与已知易误伤词（如 `meter` 命中 `parameter`）的边界处理见脚本。

## 6. 开源许可与数据红线（D-SPD-19）

内核开源前必须逐项落地的**事实清单**，由 `node scripts/check-license.mjs` 产出（report-only；`--strict` 才判红）：

| 项 | 判据 | 现状 |
|---|---|---|
| 包许可 | 每个 `packages/*` / `industries/*` / `apps/*` 的 `package.json` MUST 声明 `license` | **已落地（2026-10 用户裁决）**：**仅研究免费、商用收费** → 见 [LICENSE](./LICENSE)，SPDX `LicenseRef-MedTrust-Research-1.0`，12 个工作区包全部声明。⚠️ 此为 **source-available（源可见）而非开源**——本仓与变更集文档中的「开源」均按「源可见」理解。正文待法务确认，版权人待替换为实际法律主体 |
| 许可制词典 | 出现 SNOMED CT / LOINC / ICD / ATC / OMOP / IEC 61850 / CIM 处 MUST 标注来源或改为运行期加载 | **已核查（2026-10）**：**未捆绑完整编码表**——命中主要是类型/字段**名称引用**，加**测试夹具中的少量概念 ID**（如 `apps/connector/src/domain/data-source/__fixtures__/hospital-cdm-v54.sql` 的 3 条 SNOMED）。真实暴露远低于计数所示；待裁决「夹具是否随开源发布」 |
| 演示数据真实机构名 | 发布前 MUST 替换为合成名 | **已执行（2026-10，用户授权）**：`node scripts/plan-demo-anonymization.mjs --write`（映射见 `scripts/demo-alias-map.json`）。**已跟踪文件内容残留 = 0，含真实名的已跟踪路径 = 0**（`openspec/changes/archive/**` 历史不改写）；同步改写了 15 个数据目录名。**关键设计**：合成 slug MUST **无内部连字符**——舞台 id 由 `p-<slug>` **去连字符派生**（`src_<slug无连字符>`），带连字符的替换值会破坏该不变量（详见 KERNEL.md 下方注）。 |
| vendored 代码 | `vendor/*` 解压目录 MUST 有 LICENSE 或完成许可核查 | **已核查（2026-10）**：`vendor/ai-factory`（治理校验引擎，被 `pnpm governance` 调用）**无 LICENSE/COPYING，package.json 亦无 license 字段** → 发布前**必须**取得授权或替换，否则内核不能发布 |
| SPDX 头 | 内核源文件 SHOULD 带 SPDX 标识 | 待补（随许可裁决一并做） |

**三方一致性套件**（`scripts/conformance/check-pack.mjs` + [README](./scripts/conformance/README.md)）：包作者**无需内核私有件**即可自检包声明（必填字段 / 六根缝名 / 不得扩张机制层）。

### 6.1 真实机构名清理（已执行）——两条硬约束

1. **合成 slug MUST 无内部连字符**。业务 id 由 slug **去连字符派生**：`p-huashan` → `src_phuashan`。
   若把 slug 换成 `demohosp-a`，派生结果（`pdemohosp-a`）与源码派生（`pdemohospa`）不一致，
   会静默打断签名/舞台/结算链路。正确做法是 `huashan → demohospa`（单 token），派生形式自然一致。
2. **改名面 = git 已跟踪文件**（发布面）。未跟踪的 `data/raw`、`data/synthea` 生成物有 8.5G 且**不发布**，
   只改其**目录名**以保持本地路径可解析；其中的二进制夹具（`*.parquet`）不改字节（变长会破坏格式），
   需在下次生成时自然取得新名。

**部署协同项（MUST NOT 静默）**：环境变量键随本仓一同改名（`CDM_DEMOHOSPA_PASSWORD` /
`CONTRACT_DEMOHOSPA` / `CONTRACT_DEMOHOSPB`），`DEPLOY.md` 与 `fly-services/**` 已同步；
**已部署环境的 Fly secrets 必须由运维同步更新**，否则连接器读不到口令/CDM 配置即 fail-closed 拒绝启动。

## 7. 空间与平面正交

- **空间** = 治理 / 行业边界（逻辑隔离），行业由空间绑定的能力包表达。
- **平面** = 数据物理归属（control-plane / connector-local）。
- 二者正交；`spaceId` 是元数据维度，给控制面表加 `spaceId` **不违反 D7**（D-SPD-2 / D-SPD-16）。
