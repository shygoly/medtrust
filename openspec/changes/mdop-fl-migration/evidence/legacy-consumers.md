# 旧链隐藏消费者清点（tasks 1.2，2026-10-14）

判据：对「换通道后是否有人按旧通道的产物读」逐面 grep（**只读、不改**）。

## 1. 逐面结果

| 面 | 命令 | 结果 |
|---|---|---|
| 结算 | `grep -rn 'fl_prediction\|flPrediction\|fl-orchestrator' apps/api/src/runtime/settlement` | **0 命中**：结算模块不读旧链/旧表 |
| 存证 / 审计 | 对 `runtime/digital-contract`、`runtime/connector-audit`、`connector/src/domain/audit.ts` 同上 | **0 命中** |
| RBAC | `grep -rn ... apps/api/src/auth` | 仅 `auth.constants.ts:1` 一行**注释**（说明 federated 用户按 participantId 绑定），无功能耦合 |
| 导航 / 入口 | `grep -rln 'fl-prediction\|federated' apps/web/src` | 命中页面见下表；新任务页已收敛 MDOP，历史页只读 |

**结论**：结算 / 存证 / RBAC **对旧链零功能耦合** —— 换通道不改变它们的输入（这条直接支撑 tasks 4.3）。

## 2. 旧链 API 面（5.4 待删；本变更不动）

`grep -rln 'cp_fl_prediction\|fl-orchestrator' apps/api/src apps/web/src`（10 个文件）：

- `apps/api/src/runtime/fl-orchestrator/{fl-orchestrator.module,fl-orchestrator.controller,fl-orchestrator.service.spec}.ts`
- `apps/api/src/runtime/connector-tasks/{connector-tasks.module,connector-tasks.controller}.ts`
- `apps/api/src/runtime/rws-orchestrator/{connector-pull.controller,rws-orchestrator.module}.ts`
- `apps/api/src/runtime/rws-analytics-ladder/e2e-demohospa-demohospb.spec.ts`（测试引用）
- `apps/api/src/compute-task/dto/fl-prediction-task-spec.ts`（**已下移行业包，现存为再导出**）
- `apps/api/src/app.module.ts`（模块装配）

## 3. web 面（5.2 已完成收敛，5.4 才删旧）

| 页面 | 现状 |
|---|---|
| `space/tasks/new/fl-prediction/page.tsx` | **已收敛**：改走 MDOP 模板，落 `/space/mdop/jobs/<id>` |
| `space/tasks/[id]/page.tsx` | 历史 FL 任务**只读**横幅（迁移前经旧通道产生） |
| `space/federated/[taskId]/page.tsx` | 旧详情页，随 5.4 一起删 |
| `space/connectors`、`space/contracts`、`atlas/yaml`、`docs`、多个 console 组件 | 列表/详情展示，读平台记录，不依赖旧链 DB |

## 4. 保留（`retained`，5.4 MUST NOT 删）

- `apps/connector/src/domain/fl-prediction/`（`reason: shared-runtime`）：节点内训练与结果派生被 MDOP 通道复用；
  新包 `industries/med/src/fl/` 的规格与校验也从这里/旧链取语义。
