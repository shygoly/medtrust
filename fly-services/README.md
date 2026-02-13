# Fly.io 部署指南

本目录包含 MedTrust 项目在 Fly.io 上的部署配置，提供两种方案：

## 📂 目录结构

```
fly-services/
├── README.md                 # 本文件
├── fate-flow/               # FATE 联邦学习服务
├── fisco-bcos-node1/        # FISCO BCOS 节点1
├── fisco-bcos-node2/        # FISCO BCOS 节点2
├── fisco-bcos-node3/        # FISCO BCOS 节点3
├── mp-spdz-gateway/         # MPC 网关
└── lite/                    # ⭐ 低成本演示方案
```

---

## 🚀 两种部署方案

### 方案1: Lite 方案 (推荐用于演示)
**月成本: ~$8**

适合产品演示、概念验证、开发测试。

```bash
cd fly-services/lite
./deploy.sh
```

特点:
- ✅ 成本最低 (节省 84%)
- ✅ 部署最快 (一键脚本)
- ✅ 资源最少 (1.5GB 内存)
- ⚠️ FATE/MPC 使用模拟服务
- ⚠️ FISCO 使用单节点

### 方案2: Full 方案 (用于生产)
**月成本: ~$45**

适合生产环境、真实数据、完整功能。

```bash
# 分别部署各个服务
fly deploy --config fly-services/fate-flow/fly.toml
fly deploy --config fly-services/fisco-bcos-node1/fly.toml
fly deploy --config fly-services/fisco-bcos-node2/fly.toml
fly deploy --config fly-services/fisco-bcos-node3/fly.toml
fly deploy --config fly-services/mp-spdz-gateway/fly.toml
```

特点:
- ✅ 完整隐私计算功能
- ✅ 3节点区块链联盟
- ✅ 生产级可靠性
- ❌ 成本较高
- ❌ 部署复杂

---

## 💰 成本对比

| 项目 | Lite | Full | 节省 |
|------|------|------|------|
| **月成本** | ~$8 | ~$45 | **84%** |
| **内存** | 1.5GB | 5GB+ | 70% |
| **存储** | 1GB | 30GB | 97% |
| **部署时间** | 2分钟 | 15分钟 | - |

---

## 🎯 快速选择

### 选择 Lite 方案如果你:
- 预算有限
- 需要快速演示
- 使用模拟数据
- 开发/测试环境

### 选择 Full 方案如果你:
- 生产环境部署
- 处理真实数据
- 需要完整功能
- 高可用性要求

---

## 📖 详细文档

- [Lite 方案详情](./lite/README.md)
- [成本分析](./lite/COST_ANALYSIS.md)
- [部署脚本](./lite/deploy.sh)

---

## 🔗 相关链接

- [Fly.io 定价](https://fly.io/pricing)
- [Fly.io 文档](https://fly.io/docs/)
- 项目 README

---

*最后更新: 2026-02-13*
