## Why

新版 GCP（2026-09-01 施行）首设「数据治理」专章（元数据、稽查轨迹、计算机化系统验证），CSDR 正承担国家药监局课题《RBQM 分类分层实施路径和能力建设》——跨中心质量信号（KRI/QTL）从"最佳实践"变成监管正面需求。平台已具备跨中心聚合、输出闸门、审计/告警底座，但全仓无任何 KRI/QTL/监查代码，RBQM 视角完全缺位（2026-09-19 张江「高质量临床研究研讨会」演示筹备中确认为对罗氏 RBQM 团队、示范甲张菁团队、CSDR 课题组的最大能力缺口）。

## What Changes

- 控制面新增 **KRI 定义与 QTL 阈值配置**：指标口径、计算窗口、阈值分层（对齐 CSDR 课题的"分类分层"：风险等级 × 站点类别），按研究/按站点生效。
- 连接器新增 **站点级 KRI 聚合计算**：数据完整性、录入及时性、缺失率、AE 上报延迟、记录修改频次等，全部在院内本地计算，**仅聚合指标经输出闸门出域**（`raw-local` 不出现在任何跨域边，FLOWS 红线不变）。
- 新增 **RBQM 监查台**（`/space/rbqm`）：KRI 热力/趋势、QTL 越限清单、分类分层视图；`compliance`/`operator` 角色可见（复用 space-nav 角色门控）。
- **QTL 越限联动**：越限事件进入合规告警流，事件哈希上长安链存证（复用既有 attestation 通道）。
- 治理边界：**无新增 LLM 调用点**（AGENT.md 无涉）；连接器平面继续无 agent（R1 不变）。
- 非目标（明确排除）：不做 EDC/试验数据采集，不替代 CTMS；KRI 面向数据空间内多中心研究的数据质量监查（研究级 RBQM），试验运行体系对接留作 future。

## Capabilities

### New Capabilities
- `rbqm-monitoring`: KRI 指标定义与 QTL 阈值配置、越限检测与分类分层视图、监查台展示、越限告警与上链存证的控制面能力。

### Modified Capabilities
- `data-space-connector`: 新增站点级 KRI 聚合任务类型——连接器须在本地计算质量指标、经输出闸门校验后仅回传聚合值；无有效合约/授权时 fail-closed 拒绝（与既有 PEP 语义一致）。

## Impact

- `apps/api/src/runtime/`：新增 `rbqm` NestJS 模块（controller/service/dto + `cp_` 前缀控制面实体，注册进 `ControlPlaneDataSource`，只存元数据与聚合指标）。
- `apps/connector/src/domain/`：新增 `kri-aggregator` 纯域服务，复用 `local-store` 出域守卫与 `output-gate`（小格抑制阈值同样适用于 KRI 分层格）。
- `apps/web`：新增 `/space/rbqm` 页面，`space-nav.tsx` 合规组挂菜单。
- 治理契约同步（`node scripts/check-meta-docs.mjs` 必须绿）：DOMAIN.md（新实体入覆盖矩阵，控制面平面）、FLOWS.md（新任务链：`crosses: control-plane↔connector-local`，`payload: aggregate`）、TRUST.md（如新增控制点登记 CTL-x）、DECISIONS（如产生不可逆决策登记 D-AREA-NN）。
- 不触碰：现有 RWS 阶梯（L1.5–L4）、数字合约、存证接口的既有行为。
