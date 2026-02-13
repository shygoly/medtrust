# MedTrust - 医疗可信数据空间

基于 Next.js SaaS Starter 构建的医疗数据可信空间平台。

## 核心概念

### 租户模型（可信空间角色）

MedTrust 采用 SaaS 多租户架构，每个租户代表可信空间中的一个角色：

| 租户类型 | 角色 | 权限 |
|---------|------|------|
| **数据提供方** | Data Provider | 上传数据、定义使用策略、获得收益 |
| **数据使用方** | Data Consumer | 申请数据使用、执行计算、获取结果 |
| **平台运营方** | Platform Admin | 租户管理、审计监管、纠纷仲裁 |
| **技术提供方** | Tech Provider | 算法入驻、计算服务、技术支撑 |

## 技术栈

- **框架**: Next.js 14 + React 18 + TypeScript 5
- **样式**: Tailwind CSS + shadcn/ui
- **数据库**: PostgreSQL + Drizzle ORM
- **认证**: NextAuth.js
- **支付**: Stripe (数据交易结算)

## 目录结构

```
src/
├── app/                    # Next.js App Router
│   ├── (dashboard)/       # 仪表板路由组
│   ├── api/               # API 路由
│   └── login/             # 认证页面
├── components/            # React 组件
│   └── ui/               # shadcn/ui 组件
├── lib/                   # 工具函数
│   ├── db/               # 数据库 schema
│   └── auth/             # 认证配置
└── public/               # 静态资源
```

## 可信空间功能

### 1. 数据沙箱 (Data Sandbox)
- 隐私计算环境隔离
- 多方安全计算 (MPC)
- 联邦学习 (Flower)

### 2. 数据确权 (Data Ownership)
- 区块链存证 (FISCO BCOS)
- 使用授权管理
- 收益分配追踪

### 3. 可信审计 (Trusted Audit)
- 全链路操作日志
- 计算过程验证
- 合规报告生成

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env.local

# 初始化数据库
pnpm db:push

# 开发服务器
pnpm dev
```

## 文档

- [技术调研](../research/technical/)
- [架构设计](./docs/architecture/)
- [API 文档](./docs/api/)

---

*基于 Next.js SaaS Starter 构建*
