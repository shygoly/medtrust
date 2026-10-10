# OMOP CDM 院内库接入手册（医院 DBA · 连接器运维）

> 适用：已完成 **OMOP CDM v5.4** ETL、库为 **PostgreSQL** 的医院。其它方言（Oracle / SQL Server /
> 达梦 / 人大金仓 / OceanBase）本版**明确拒绝**，不会用近似方言凑合执行。
> 决策依据：DECISIONS D-CN-6（连接器独占库句柄）、D-CN-7（只接 CDM，视图层 + 双权限域）；
> 控制点：TRUST CTL-25。可执行 SQL：[`omop-cdm-onboarding.sql`](./omop-cdm-onboarding.sql)。

## 0. 一句话

医院在 CDM 底表之上建一层**视图**，给连接器一个**恰好两类权限**的普通账号：
**视图只读 + `results` 区可建表**。连接器只能透过视图看数据，底表对它物理不可达；
医院随时一条 `REVOKE` 就能单方面切断，不需要平台任何配合。

> **⚠ 纯只读账号不满足接入契约。** 队列定义要把 cohort 写进 `results` schema；
> 只给 SELECT 的账号会在接入校验被拒，报「纯只读账号不满足接入契约」。
> 这是本手册最常见的上线失败原因。

## 1. 布局

```
<底表 schema，如 omop>        ETL 产物，含医院自有列     连接器：无任何权限
        │ 视图（医院 DBA 所有）
        ▼
medtrust_cdm                 同名视图，去标识、可行级过滤   连接器：只读（权限域 ①）
medtrust_results             连接器的中间结果区            连接器：可建表可写（权限域 ②）
```

schema 名可以改，但连接器配置里要对应上；`results` 不能与视图 schema 同名。

## 2. 医院 DBA：执行一份 SQL

```bash
psql -d <库名> \
  -v base_schema=omop \
  -v view_schema=medtrust_cdm \
  -v results_schema=medtrust_results \
  -v connector_role=medtrust_connector \
  -v connector_password='<强口令>' \
  -f docs/omop-cdm-onboarding.sql
```

它做四件事，可重复执行：

1. 建 `medtrust_cdm`、`medtrust_results` 两个 schema；
2. 建七个必需视图：`person`、`observation_period`、`drug_exposure`、`condition_occurrence`、
   `concept`、`vocabulary`、`cdm_source`；
3. 建（或更新）连接器账号：普通 LOGIN 账号，**不是**超级用户，不能绕过行级安全、不能建角色或建库；
4. 授权恰好两个域：视图只读；`results` 的 `USAGE, CREATE`。底表显式不授权。

### 视图的规则（你真正要审的地方）

| 规则 | 为什么 | 接入校验会不会查 |
|---|---|---|
| 视图名、列名与 CDM v5.4 规范一致 | 连接器按规范生成 SQL，不探测表结构 | 会：缺视图即拒 |
| 只放**规范内**的列；底表上医院自加的列（身份证号、姓名、手机号……）不进视图 | 直接标识不出视图 | 会：多出规范外的列即拒并点名 |
| 规范内但承载标识的列也不进视图：`person_source_value`（ETL 惯例是病案号）、精确出生日期（只留 `year_of_birth`）、`drug_exposure.sig`（自由文本医嘱） | 规范允许它们存在，但它们能反查到人 | 会查 `person_source_value`；其余靠你 |
| 其它 `*_source_value` 列是否夹带标识 | 取决于本院 ETL 怎么填 | **不会**——请按本院实际审查 |
| 行级过滤写在视图 `WHERE` 里（退出研究者、特殊保护人群……），**每张含 `person_id` 的视图用同一条件** | 被过滤的人对连接器不可见 | **不会**——连接器无法证明你的过滤逻辑对 |

SQL 文件末尾有行级过滤的示例写法。

### 常见的「看起来没问题、其实越权」

- 底表或其它 schema 的表对 `PUBLIC` 授过 SELECT：连接器账号自动继承，接入校验会报
  **最小权限域失败**并按 schema 点名。请 `REVOKE ... FROM PUBLIC`，或把这些表挪出去。
- 把连接器账号设成库 owner 或超级用户「图省事」：超级用户绕过全部视图与权限，
  接入校验报**账号属性域失败**。
- PostgreSQL ≤ 14 的 `public` schema 默认对所有人可建表：建议 `REVOKE CREATE ON SCHEMA public FROM PUBLIC`
  （这是全库级改动，请按本院规范评估）。

## 3. 连接器运维：配置

口令**只放环境变量**，配置里只写变量名：

```bash
export DEMOHOSPA_CDM_PASSWORD='<DBA 给的口令>'          # 按 secret 管理，不进仓库、不进日志
export CONNECTOR_CDM_SOURCES='[{
  "label": "demohospa-cdm",
  "type": "omop-cdm",
  "host": "10.0.0.5", "port": 5432, "database": "cdm",
  "user": "medtrust_connector", "passwordEnv": "DEMOHOSPA_CDM_PASSWORD",
  "cdmVersion": "5.4", "dbms": "postgresql",
  "schemas": { "cdm": "medtrust_cdm", "vocabulary": "medtrust_cdm", "results": "medtrust_results" }
}]'
```

- 也可以写进文件，用 `CONNECTOR_CDM_SOURCES_FILE` 指向它。
- 配置项是**白名单**：写了 `password` 字段、带口令的连接串、或任何不认识的项（比如想「开放给 agent」）都会在启动时被拒。
  数据源只供连接器进程自己用——算法模块拿不到任何数据接口，训练 agent 若被配了数据库变量会拒绝启动。
- `CONNECTOR_CDM_REVERIFY_MS`：周期复核间隔，缺省 6 小时；`0` 表示只在启动时校验。

在平台上发布数据产品时，数据源只声明一个 label——**控制面永远不知道库地址和口令**：

```json
{ "dataSource": { "type": "omop-cdm", "label": "demohospa-cdm" } }
```

声明为 CDM 的产品不能再带本地文件路径；两者同时出现会被拒（不存在「库连不上就改读文件」的退路）。

## 4. 接入校验：看懂结果

连接器启动时和每次周期复核都会跑一遍，结果写进连接器本地审计与状态表。失败按**权限域**归因，
一条日志就能定位：

| 权限域 | 查什么 | 典型失败与处理 |
|---|---|---|
| 账号属性 | 非超级用户、无 BYPASSRLS、不能建角色 / 建库 | 为连接器单独建普通账号 |
| 最小权限 | 允许的 schema 之外，任何表 / 视图都读不到 | 按日志点名的 schema `REVOKE`（常见：对 PUBLIC 的历史授权） |
| CDM 视图只读 | 七个视图都在、可读、**不可写** | 补建视图；只给 SELECT |
| 视图契约 | 视图列不含规范外的列与 `person_source_value` | 从视图里去掉点名的列 |
| results 可写 | 能在 `results` 建表、能删掉 | `GRANT USAGE, CREATE ON SCHEMA medtrust_results` |
| 元数据 | `cdm_source` 可读，声明的 CDM 版本与配置一致 | 授权 `cdm_source` 视图；核对 `cdm_version` |

校验不过，数据源就是**不可用**：引用它的任务直接失败，**不会**悄悄改用其它数据。
通过之后，连接器把版本与覆盖统计（各表**数量级**、观察期**到月**）报给平台目录——
只有统计量，没有任何一行数据。目录上会注明这是「该院自报、由连接器读取」的事实，不是平台的质量背书。

## 5. 医院单方面切断

```sql
REVOKE SELECT ON ALL TABLES IN SCHEMA medtrust_cdm FROM medtrust_connector;
```

连接器下一条查询即被数据库拒绝；下一次周期复核判数据源不可用，目录上的覆盖元数据标为「待刷新」。
恢复访问：重新 `GRANT`，下一次复核即恢复。**整个过程不需要平台配合**——这是设计目标，不是副作用。

## 6. `results` 区里会出现什么

连接器建的中间表一律命名为 `mt_<UTC 时刻>_<任务标识>_<用途>`（任务标识是任务号的 SM3 前缀，
任务号本身不写进你的库）。任务结束即删；连接器崩溃留下的表在复核时兜底清理。
连接器**只会删它自己建的、且符合这个命名的表**，你放在这个 schema 里的其它东西永远不会被动。
你也可以随时手工删除任何 `mt_` 表。

## 7. 本版的边界（如实）

- **CDM 上的分析任务本版不开放**：接入、校验、覆盖元数据、取数机制都已就绪，但队列定义与时间窗
  （「用药后多久内发生」）的语义要由后续变更提供；在那之前，引用 CDM 数据产品的任务会明确失败并说明原因。
- **视图性能只在合成数据上测过**：100 万人 / 各 1000 万条用药与诊断的合成库上，只裁列的视图零开销，
  带行级过滤的视图照常走索引、选择性查询慢 1.25–1.5×（`sh apps/connector/scripts/omop-view-benchmark.sh` 可复现）。
  **本院真实分布与硬件上的表现仍须接入前实测**；若成为瓶颈，退路是由医院刷新的物化视图（控制权不变）。
- 只支持 PostgreSQL + CDM v5.4。

## 8. 自查演练

`sh apps/connector/scripts/omop-onboarding-drill.sh` 会起一个全新的 PostgreSQL，灌一个带身份证号 /
姓名列的「医院 CDM 库」，**原样**执行本手册的 SQL（执行两遍验证幂等），再用连接器接入：
校验通过 → 底表不可达、视图不可写 → 标识列不可见 → 跑真实查询 → `results` 清理 → 医院 REVOKE 即断。
