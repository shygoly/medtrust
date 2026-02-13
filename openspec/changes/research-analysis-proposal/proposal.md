## Why

MedTrust 已完成基础架构（认证、加密、密钥管理），但缺少核心隐私计算和可信机制能力。research 目录中的技术调研（隐私计算、数据安全、区块链）提供了明确的技术选型和实现路径，现需将这些研究成果转化为可执行的技术规范，支撑 Phase 3（隐私计算）和 Phase 4（可信机制）的开发。

## What Changes

- **新增联邦学习能力**：集成 FATE 框架，支持跨医院 AI 模型训练（横向/纵向联邦学习）
- **新增多方安全计算**：集成 MP-SPDZ，支持跨机构敏感数据联合统计（患者数量、药物疗效均值等）
- **新增可信执行环境**：接入阿里云 SGX 机密计算，支持密文数据实时计算（基因分析等敏感场景）
- **新增区块链存证**：集成 FISCO BCOS 联盟链，支持医疗数据存证、处方流转、药物溯源
- **新增医疗数据标准**：集成 FHIR R4，支持标准化医疗数据交换

## Capabilities

### New Capabilities

- `federated-learning`: FATE 联邦学习集成 - NestJS 服务封装、任务调度、模型管理 API
- `multi-party-computation`: MP-SPDZ 多方安全计算 - 安全求和/均值、C++ FFI 集成、会话管理
- `trusted-execution-env`: 阿里云 SGX TEE 计算 - Enclave 实例管理、远程证明、密文计算 API
- `blockchain-attestation`: FISCO BCOS 区块链存证 - 智能合约、存证 API、验证查询
- `fhir-integration`: FHIR R4 医疗标准 - 资源转换、患者/病历 CRUD、标准化数据交换

### Modified Capabilities

<!-- 无现有能力需求变更 -->

## Impact

**新增模块**：
- `apps/api/src/privacy/` - 隐私计算模块（fate/mpc/tee 子模块）
- `apps/api/src/blockchain/` - 区块链存证模块
- `apps/api/src/fhir/` - FHIR 标准集成模块

**新增依赖**：
- `axios` - FATE Flow API 调用
- `sm-crypto` - 国密算法（已有，用于区块链）
- `fisco-bcos-browser-sdk` - FISCO BCOS SDK
- `fhir-kit-client` - FHIR R4 客户端

**外部服务依赖**：
- FATE Flow 服务（Python 微服务，端口 9380）
- MP-SPDZ 网关（C++ 服务）
- 阿里云 SGX 机密计算实例
- FISCO BCOS 联盟链节点（3 节点，端口 20200/8545）

**数据库影响**：
- 新增表：`federated_learning_jobs`、`mpc_sessions`、`tee_computations`、`blockchain_attestations`

**API 影响**：
- 新增 REST API：`/api/privacy/fl/*`、`/api/privacy/mpc/*`、`/api/privacy/tee/*`
- 新增 REST API：`/api/blockchain/attest`、`/api/blockchain/verify`
- 新增 REST API：`/api/fhir/Patient`、`/api/fhir/Observation`

**部署影响**：
- docker-compose.yml 新增服务：fate-flow、fisco-bcos-node
- 月成本增加约 ¥12000（FATE ¥4000 + SGX ¥5000 + FISCO ¥3000）
