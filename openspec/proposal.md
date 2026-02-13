## Why

医疗数据孤岛问题严重，数据共享面临隐私、安全和信任三大挑战。现有解决方案要么过于中心化（数据集中存储风险高），要么过于去中心化（缺乏可信机制）。需要一个兼顾数据隐私保护、数据所有权确认和可信审计的医疗数据共享平台。

MedTrust 旨在构建一个医疗可信数据空间，让数据提供方能够安全地共享数据并获得收益，数据使用方能够在保护隐私的前提下使用数据，平台提供全程可信的审计和仲裁机制。

## What Changes

### Architecture Changes
- **Monorepo structure**: 分离 frontend (Next.js) 和 backend (NestJS)
- **SQLite database**: 轻量级本地数据库，适合中小规模部署
- **NestJS backend**: 企业级 Node.js 框架，提供 REST API 和 WebSocket 支持

### Core Modules

#### 1. Multi-Tenant System
- Tenant registration and verification (KYC)
- Role-based access control (Provider/Consumer/Admin/Tech)
- Tenant isolation and resource quotas

#### 2. Data Asset Management
- Data asset upload and metadata management
- Data quality assessment and scoring
- Usage policy configuration (pricing, access conditions)
- Data discovery and catalog

#### 3. Data Access Workflow
- Access request submission and approval workflow
- Usage agreement and consent management
- Payment processing for data usage

#### 4. Privacy-Preserving Computation
- Secure sandbox environment for data processing
- Integration with MPC (Multi-Party Computation) frameworks
- Integration with Federated Learning (Flower)
- TEE (Trusted Execution Environment) support

#### 5. Audit and Compliance
- Comprehensive audit logging
- Blockchain-based data provenance (FISCO BCOS)
- Compliance reporting and monitoring

#### 6. Settlement and Incentives
- Usage-based billing and settlement
- Revenue sharing between data providers and platform
- Transaction history and statements

## Capabilities

### New Capabilities

- `tenant-management`: Multi-tenant registration, verification, and lifecycle management
- `data-asset-management`: Upload, catalog, and manage medical data assets with metadata
- `access-control`: Fine-grained access control with policy-based permissions
- `privacy-computation`: Execute privacy-preserving computation tasks (MPC, FL, TEE)
- `audit-logging`: Comprehensive audit trail for all data access and operations
- `blockchain-notary`: Blockchain-based data provenance and transaction notarization
- `billing-settlement`: Usage tracking, billing, and revenue distribution

### Infrastructure Capabilities

- `nestjs-api`: RESTful API with NestJS framework
- `sqlite-database`: SQLite with TypeORM for data persistence
- `websocket-realtime`: Real-time updates via WebSocket
- `jwt-auth`: JWT-based authentication and authorization
- `monorepo-structure`: Organized monorepo with frontend/backend separation

## Impact

**New Code**:
- Backend: NestJS modules (Auth, Tenant, DataAsset, AccessRequest, ComputeTask, Audit, Billing)
- Frontend: Next.js pages for tenant dashboard, data catalog, compute tasks, audit logs
- Database: SQLite schema with TypeORM entities
- Integration: Flower (FL), FISCO BCOS (Blockchain), MP-SPDZ (MPC)

**Dependencies**:
- Backend: @nestjs/core, @nestjs/typeorm, better-sqlite3, @nestjs/websockets, @nestjs/passport
- Frontend: next, react, tailwindcss, shadcn/ui, @tanstack/react-query
- Privacy Computing: flower (Python), node-fate (Node.js wrapper)

**Systems Affected**:
- New backend service (NestJS on port 3001)
- Frontend application (Next.js on port 3000)
- SQLite database file (medtrust.db)
- Optional: Flower server, FISCO BCOS node

**User Impact**:
- Medical institutions can monetize their data assets safely
- Researchers can access diverse medical data for AI training
- Platform provides trusted intermediary for data transactions
- All operations are auditable and compliant with regulations
