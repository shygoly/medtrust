# MedTrust 前端实现报告

## 📋 项目概述

基于 **Next.js SaaS Starter** 概念开发的 MedTrust 医疗可信数据空间前端。

## 🎯 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 16.1.6 | React 框架 (App Router) |
| React | 19.2.3 | UI 库 |
| TypeScript | 5.x | 类型系统 |
| Tailwind CSS | 4.x | 样式 |
| shadcn/ui | 3.x | UI 组件 |
| Axios | 1.13.x | HTTP 客户端 |
| TanStack Query | 5.x | 状态管理 |
| Zustand | 5.x | 全局状态 |
| Lucide React | - | 图标库 |

## 📁 项目结构

```
apps/web/
├── src/
│   ├── api/
│   │   └── client.ts          # API 客户端
│   ├── app/
│   │   ├── (dashboard)/        # Dashboard 路由组
│   │   │   ├── layout.tsx      # Dashboard 布局
│   │   │   └── page.tsx        # Dashboard 首页
│   │   ├── login/
│   │   │   └── page.tsx        # 登录页
│   │   ├── register/
│   │   │   └── page.tsx        # 注册页
│   │   ├── layout.tsx          # 根布局
│   │   └── page.tsx            # 根页面（跳转）
│   ├── components/
│   │   ├── dashboard/          # Dashboard 组件
│   │   ├── layout/             # 布局组件
│   │   └── ui/                 # UI 组件
│   ├── hooks/                  # 自定义 Hooks
│   ├── lib/
│   │   └── utils.ts            # 工具函数
│   └── types/
│       └── index.ts            # TypeScript 类型
├── package.json
└── next.config.ts
```

## ✅ 已完成功能

### 1. 认证系统
- [x] 登录页面 (`/login`)
- [x] 注册页面 (`/register`)
- [x] JWT Token 管理
- [x] 路由保护

### 2. Dashboard
- [x] 布局组件 (顶部导航)
- [x] 统计卡片展示
- [x] 快速操作入口

### 3. API 客户端
- [x] 封装 Fetch API
- [x] 自动 Token 注入
- [x] 错误处理

### 4. 类型定义
- [x] User 类型
- [x] Tenant 类型
- [x] DataAsset 类型
- [x] AccessRequest 类型

## 🚀 启动方式

```bash
# 进入前端目录
cd apps/web

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build
```

## 🔗 路由结构

| 路径 | 功能 | 权限 |
|------|------|------|
| `/` | 自动跳转到登录 | 公开 |
| `/login` | 登录页面 | 公开 |
| `/register` | 注册页面 | 公开 |
| `/dashboard` | 仪表板首页 | 需登录 |
| `/dashboard/tenants` | 租户管理 | 需登录 |
| `/dashboard/assets` | 数据资产 | 需登录 |
| `/dashboard/requests` | 访问申请 | 需登录 |

## ❌ 删除的 SaaS 模板功能

| 功能 | 原因 |
|------|------|
| Stripe 支付 | MedTrust 使用数据使用计费，非订阅模式 |
| Pricing 页面 | 无定价页面需求 |
| 订阅管理 | 无需订阅概念 |
| 邮件验证 | 简化流程 |

## ➕ 新增功能

| 功能 | 描述 |
|------|------|
| 租户管理 | 多租户架构支持 |
| 数据资产 | 医疗数据目录 |
| 访问申请 | 数据使用审批流程 |
| 可信空间 | 隐私计算集成 |

## 📊 与后端集成

前端通过 API 客户端与后端通信：

```typescript
// API 基础配置
const API_BASE_URL = 'http://localhost:3001/api/v1';

// 认证方式
Authorization: Bearer <JWT_TOKEN>
```

## 🎨 UI 设计

- **配色**: 蓝色主色调 (#2563EB)
- **布局**: 侧边栏 + 顶部导航
- **组件**: 使用 shadcn/ui 基础组件
- **响应式**: 支持移动端适配

## 📈 下一步

- [ ] 租户列表页面
- [ ] 数据资产上传
- [ ] 访问申请表单
- [ ] 审批流程界面
- [ ] 数据沙箱可视化

---

*创建时间: 2026-02-11*
*前端框架: Next.js 16 + React 19*
