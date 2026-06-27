# MedTrust - 医疗可信数据空间

基于 **OpenSpec** 驱动的医疗数据可信空间平台。

## 🏗️ 技术架构

```
medtrust/
├── apps/
│   ├── web/                 # Next.js 16 前端
│   │   ├── app/            # App Router
│   │   ├── components/     # React 组件
│   │   └── lib/            # 工具函数
│   │
│   ├── api/                 # NestJS 10 控制平面
│   │   └── src/
│   │
│   └── connector/           # NestJS 连接器节点（部署于各参与方本地）
│       └── src/domain/
│
├── packages/
│   ├── database/            # TypeORM 实体 + 3 个 DataSource
│   │   ├── entities/        # AppDataSource (核心实体)
│   │   ├── control-plane/   # ControlPlaneDataSource (目录/合约/身份/存证)
│   │   └── connector/       # ConnectorDataSource (连接器本地)
│   ├── demo-scenario/       # 演示场景
│   └── proto/               # Protobuf 定义
│
├── .conductor/              # Conductor 多 agent 编排工作流
├── openspec/                # OpenSpec 规范
└── docker-compose.yml       # Vault + Postgres 开发环境
```

**端口约定: 5020–5029**（3000 被其他项目占用）:
- `5020` — 前端 (Next.js)
- `5021` — API 控制平面 (NestJS)
- `5022` — 连接器 (NestJS)
- `5023-5029` — 预留 (Flower, MPC, 区块链等)

## 🎯 核心特性

### 联邦可信数据空间（已从集中式多租户迁移）

旧集中式模块 (`data-asset`、`access-request`) 已移除。授权走联邦路径：

| 组件 | 说明 |
|------|------|
| **Catalog** | 数据产品目录（`apps/api/src/runtime/catalog/`） |
| **Digital Contract** | 数字合约（`apps/api/src/runtime/digital-contract/`），由连接器 PEP 强制执行 |
| **Participant Identity** | SM2 CA + 双认证准入 |
| **Settlement** | 按贡献分账 |

**数据永不离开数据提供方** — 连接器 (`apps/connector/`) 部署于各医院/药企本地，原始行数据仅通过 connector 本地存储访问。

### 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS + shadcn/ui |
| **后端** | NestJS 10 + TypeScript |
| **数据库** | SQLite (better-sqlite3, WAL mode) + TypeORM |
| **认证** | JWT + Passport + SM2 双认证 |
| **加密** | SM2/SM3/SM4 (sm-crypto) + HashiCorp Vault |

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
```

**必需**:
- `DATABASE_URL` — SQLite 数据库路径（默认 `./data/medtrust.db`）
- `JWT_SECRET` — JWT 签名密钥
- `VAULT_ADDR` — Vault 地址（默认 `http://localhost:8200`）
- `VAULT_TOKEN` — Vault 令牌（开发: `dev-token-12345`）

详见 `.env.example` 和 `.env.fly.example`。

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

### Phase 1: 基础架构 ✅
- [x] Monorepo 结构 + OpenSpec
- [x] NestJS 控制平面 + 连接器
- [x] 3 个 DataSource（App / ControlPlane / Connector）
- [x] 国密 SM2/SM3/SM4 + Vault 密钥管理
- [x] 列级加密 + API 脱敏
- [x] 限流 + 全局异常过滤 + 优雅关闭

### Phase 2: 联邦架构 ✅
- [x] 参与方身份（SM2 CA + 双认证）
- [x] 数字合约 + PEP 强制执行
- [x] 数据产品目录
- [x] 按贡献分账
- [x] 连接器本地节点（数据不离开提供方）

### Phase 3: 隐私计算（进行中）
- [x] Flower 联邦学习
- [x] MP-SPDZ 安全多方计算
- [x] TEE 可信执行环境
- [x] FISCO BCOS 区块链存证
- [ ] ML 执行器 + NLP 管道

### Phase 4: 可信机制
- [x] 审计日志
- [x] L2 合规引擎
- [ ] 跨空间互联（联邦目录 + 合约互认）

---

*基于 OpenSpec 规范驱动开发*
