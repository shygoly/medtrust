# Capability: Plan Editor

## Purpose

The plan editor enables users to create and edit MDOP logical plans directly in the compose interface, ensuring that template-generated plans and manually edited plans follow the same structure and validation rules.

## Requirements

### Requirement: compose 页产出 MDOP 逻辑计划

`compose` 页 SHALL 直接编辑并产出 **MDOP 逻辑计划**（阶段、算子、`at` 放置、合约引用、时间窗），
MUST NOT 维护第二套仅供演示的编排形状；页面向导（模板）与自由编辑 MUST 产出同一形状的计划。

#### Scenario: 向导产出与自由编辑同形

- **WHEN** 用户用某一模板向导填写参数生成计划，并把它送进编辑器
- **THEN** 编辑器中的计划与用户手工编辑生成的计划 MUST 无法区分（同一 `LogicalPlanDraft` 形状，
  经同一 schema 解析），且两者走同一份后续校验

#### Scenario: 非法计划在提交前不可放行

- **WHEN** 编辑器中的计划缺少合约、存在重名阶段 id，或引用了未注册算子
- **THEN** 页面 MUST 给出可读原因，且后端 MUST 继续 fail-closed（页面提示只是提示，不构成放行依据）

### Requirement: 计划判定只做一次（编译期）

数据就近（`ds://` 句柄归属）、C2 目标证明策略、排序契约与阶段 id 唯一性等判定 MUST 只在后端编译期执行；
前端 MUST NOT 复制这些判定规则（避免两套规则漂移导致「页面通过、编译失败」或反向的假放行）。

#### Scenario: 前端提示与后端判定不一致时以后端为准

- **WHEN** 某个计划在前端提示中看起来可提交，但后端编译期判定不通过
- **THEN** 作业 MUST 被拒绝并记录原因（`REJECTED` + 理由），前端提示 MUST NOT 覆盖该结果
