# 任务

> 阶段编号与 `design.md` 的 Migration Plan 对齐。P0 为本变更集自身；P1–P11 为落地。

## P0 契约先行
- [x] 0.1 本变更集过 `openspec validate`
- [x] 0.2 新增 `scripts/check-kernel-purity.mjs`（denylist + 依赖方向 + **词元边界匹配**）+ 负例自检
- [x] 0.3 以候选目录基线跑出**越界清单**（当前布局尚无 `space-kernel` / `industries`）
- [x] 0.4 术语裁决同步：`DOMAIN.md` 明确「空间 / 平面」为规范词，"信任域"退回描述词
- [x] 0.5 `DECISIONS.md` 登记 `D-SPD-1` … `D-SPD-19`
- [x] 0.6 新增 `KERNEL.md`（基座契约：能力模块 + 六根 SPI + 纯度判据）与 `PACK.md`（包契约模板）

## P1 抽缝（零行为变更）
- [x] 1.1 定义 `space-kernel-spi` 纯类型包（六根接口，签名**一次**带上 `spaceId`）
- [x] 1.2 现有医疗实现挂到 SPI 上
- [x] 1.3 `SPACE_PACKS` 降为部署白名单（保留兼容解析）
- [x] 1.4 双行业包装配测试骨架
- [x] 1.5 门禁：`pnpm test` 全绿

## P2 空间上下文
- [x] 2.1 `SpaceGuard` + JWT 多空间声明 + `X-Space-Id` 覆盖（仅限本用户空间）
- [x] 2.2 `AsyncLocalStorage` 上下文载体
- [x] 2.3 仓储层统一注入 `WHERE space_id = ?`
- [x] 2.4 替换 57 处 `process.env.SPACE_ID`（实测 32 文件），保留默认空间 + 弃用告警
- [x] 2.5 `POST /auth/switch-space`
- [x] 2.6 越权负例测试

## P3 计量 SPI
- [x] 3.1 开放 `MeteringProvider` SPI + 开放兜底口径
- [x] 3.2 `settlement` 接 SPI；记录 `meter id/version/digest`
- [x] 3.3 兜底与算法口径对拍 + 如实标注（禁止静默假装）

## P4 数据隔离
- [x] 4.1 域内活动表加 `space_id`（身份 / 主体表保持全局）
- [x] 4.2 旧数据回填默认空间
- [x] 4.3 覆盖矩阵同步；`check:meta` 全绿
- [x] 4.4 `cp_participant.org` **保持全局唯一**（不采用联合唯一）

## P5 准入空间化
- [x] 5.1 准入 / 吊销 / 连接器注册加 `spaceId`
- [x] 5.2 范围 `global` | `per-space`
- [x] 5.3 跨空间越权准入负例

## P6 成员与邀请
- [x] 6.1 `cp_space_member` / `cp_space_invitation`
- [x] 6.2 邀请：一次性 + 有期 + 不可枚举 + 绑定被邀主体
- [x] 6.3 申请 + 审批（复用机构认证申请）；限 `operator`
- [x] 6.4 多空间登录与切换；`User.participant_id` 单值改多空间
- [x] 6.5 `Tenant` 与 `cp_participant` 合一

## P7 品牌与主题
- [x] 7.1 `cp_space.branding` + 实例品牌（部署配置兜底 + admin 设置页）
- [x] 7.2 `GET /spaces/:id/theme` + token 覆盖（白名单）
- [x] 7.3 `DESIGN.md` §1.1 改"默认主题 + 受约束覆盖层"；新增「主题令牌契约」节
- [x] 7.4 标题去硬编码（`layout.tsx`）；建议 `[spaceId]` 路由以支持 SSR
- [x] 7.5 资源净化 / 对比度校验 / 变更审计
- [x] 7.6 联邦远端只给标识，不注入 CSS
- [x] 7.7 `check-theme`（或扩展既有守护）

## P8 协作作用域
- [x] 8.1 `cp_collaboration`
- [x] 8.2 目录与成员按协作过滤（竞争方互不可见）

## P9 前端
- [x] 9.1 空间上下文由 **cookie + `X-Space-Id` 头** 携带（DOC1 §L7 允许的等价变体，保持 `/space/...` 路径）；理由：令牌在 localStorage，SSR 读不到，路径参数化同样解决不了 SSR 品牌
- [x] 9.2 空间切换器
- [x] 9.3 导航按空间权限过滤；`check:nav` 全绿
- [x] 9.4 零空间空态

## P10 连接器多栈
- [x] 10.1 多空间 × 多包装配
- [x] 10.2 密钥 / 证书按空间分栈（强制不复用）
- [x] 10.3 本地策略与出域模板按空间重算
- [x] 10.4 验收：一连接器服务两空间，跨空间密钥不复用、本地策略独立生效

## P11 开源拆分
- [x] 11.1 内核许可 + SPDX 头；查 `vendor/ai-factory` 许可
- [x] 11.2 清 demo 数据与真实机构名；核对词典许可
- [x] 11.3 三方 conformance kit
- [x] 11.4 守护分册（`check-meta-docs.mjs` 覆盖矩阵按册闭合）
