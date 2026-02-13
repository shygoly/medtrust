# MedTrust - 医疗可信数据空间

基于 **OpenSpec** 驱动的医疗数据可信空间平台。

## 🏗️ 技术架构

```
medtrust/
├── apps/
│   ├── web/                 # Next.js 14 前端
│   │   ├── app/            # App Router
│   │   ├── components/     # React 组件
│   │   └── lib/            # 工具函数
│   │
│   └── api/                 # NestJS 10 后端
│       ├── src/
│       │   ├── modules/    # 功能模块
│       │   ├── entities/   # TypeORM 实体
│       │   └── main.ts     # 应用入口
│       └── test/
│
├── packages/
│   ├── shared/             # 共享类型和工具
│   └── database/           # 数据库配置和迁移
│
├── openspec/               # OpenSpec 规范
│   ├── proposal.md         # 项目提案
│   └── changes/            # 变更集
│
└── docker-compose.yml      # 开发环境
```

## 🎯 核心特性

### 多租户架构
- **数据提供方** - 上传数据、定价、获得收益
- **数据使用方** - 申请数据、沙箱计算、获取结果
- **平台运营方** - 审核管理、审计监管
- **技术提供方** - 算法入驻、技术服务

### 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Next.js 14 + React 18 + TypeScript 5 + Tailwind CSS + shadcn/ui |
| **后端** | NestJS 10 + TypeScript |
| **数据库** | SQLite (better-sqlite3) + TypeORM |
| **认证** | JWT + Passport |
| **加密** | SM2/SM3/SM4 (sm-crypto) + HashiCorp Vault |
| **API** | REST + WebSocket |

## 📋 OpenSpec 规范

### 当前变更集 (monorepo-init)

| Spec | 描述 |
|------|------|
| `project-structure` | Monorepo 目录结构 |
| `database-schema` | TypeORM 实体定义 |
| `nestjs-backend` | NestJS 应用架构 |
| `nextjs-frontend` | Next.js 应用架构 |
| `sqlite-database` | SQLite 数据库配置 |

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动 Vault (密钥管理)

```bash
# 启动 Vault 服务
docker-compose up -d vault

# 初始化 Vault 密钥
./scripts/vault-init.sh
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑配置 (Vault 配置已包含在 .env.example 中)
```

### 4. 初始化数据库

```bash
cd packages/database
pnpm migration:run
```

### 5. 启动开发服务器

```bash
# 同时启动前后端
pnpm dev

# 或分别启动
pnpm --filter web dev
pnpm --filter api dev
```

## 🔐 安全特性

### 国密算法支持 (等保2.0/3.0 合规)

- **SM2**: 非对称加密和数字签名
- **SM3**: 密码杂凑算法
- **SM4**: 对称加密 (CBC/ECB 模式)
- **信封加密**: SM2 + SM4 组合加密大数据

### 数据库列级加密

```typescript
import { EncryptedColumn } from './security/decorators';

@Entity()
export class Patient {
  @EncryptedColumn('patient-id-card-key')
  idCard: string; // 自动加密存储
}
```

### 数据脱敏

```typescript
import { Masked } from './security/decorators';

export class PatientDTO {
  @Masked('name')
  name: string; // API 响应自动脱敏: 张三 → 张*

  @Masked('phone')
  phoneNumber: string; // 13812345678 → 138****5678
}
```

### 密钥管理

- **HashiCorp Vault**: 集中式密钥管理
- **密钥缓存**: 5分钟 TTL，减少 Vault API 调用
- **审计日志**: 记录所有密钥访问

## 📚 文档

### 安全文档
- [加密使用指南](./docs/security/encryption-guide.md)
- [数据脱敏指南](./docs/security/masking-guide.md)
- [Vault 配置指南](./docs/security/vault-setup.md)

### 项目文档
- [租户模型规范](./specs/TENANT_MODEL_SPEC.md)
- [技术调研](./research/technical/)
- [OpenSpec Proposal](./openspec/proposal.md)

## 🗺️ 开发路线图

### Phase 1: 基础架构
- [x] OpenSpec 初始化
- [x] Monorepo 结构
- [x] 数据库 Schema 设计
- [x] NestJS 后端实现
- [x] SQLite + TypeORM 配置
- [x] 国密算法集成 (SM2/SM3/SM4)
- [x] HashiCorp Vault 密钥管理
- [x] 数据库列级加密
- [x] API 数据脱敏

### Phase 2: 核心功能 (当前)
- [x] 认证与授权 (JWT)
- [x] 租户管理
- [x] 数据资产管理
- [x] 访问申请流程
- [ ] Next.js 前端实现

### Phase 3: 隐私计算
- [ ] 安全沙箱
- [x] Flower 联邦学习集成
- [ ] MPC 计算支持

### Phase 4: 可信机制
- [ ] 区块链存证
- [x] 审计日志
- [ ] 结算系统

---

*基于 OpenSpec 规范驱动开发*
