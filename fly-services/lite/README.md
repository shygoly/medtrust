# MedTrust Lite - 低成本部署方案

针对演示环境优化的 Fly.io 部署配置，**月成本从 $45 降至 $8**，节省 84%。

---

## 🎯 优化亮点

| 优化项 | 原方案 | Lite方案 | 节省 |
|--------|--------|----------|------|
| FATE Flow | 完整版 (2GB+) | Node模拟 (256MB) | ~$8/月 |
| FISCO BCOS | 3节点+Volume | 单节点 | ~$20/月 |
| MP-SPDZ | 完整编译 (1GB+) | Node模拟 (256MB) | ~$3/月 |
| VM类型 | 默认 | shared-cpu-1x | ~$5/月 |
| **总计** | **~$45/月** | **~$8/月** | **84%** |

---

## 📁 文件结构

```
fly-services/lite/
├── README.md                 # 本文件
├── COST_ANALYSIS.md          # 详细成本分析
├── deploy.sh                 # 一键部署脚本
├── fly.template.toml         # 主应用配置
├── fate-mock.toml           # FATE轻量版
├── fisco-single.toml        # FISCO单节点
├── mpc-lite.toml            # MPC轻量版
├── Dockerfile               # 主应用镜像
├── Dockerfile.fate-mock     # FATE模拟服务
└── Dockerfile.mpc-lite      # MPC模拟服务
```

---

## 🚀 快速开始

### 1. 前提条件
```bash
# 安装 flyctl
curl -L https://fly.io/install.sh | sh

# 登录
fly auth login
```

### 2. 一键部署
```bash
cd fly-services/lite
chmod +x deploy.sh
./deploy.sh
```

### 3. 查看部署状态
```bash
# 主应用
fly status --app medtrust-lite
fly logs --app medtrust-lite

# FATE
fly status --app medtrust-lite-fate

# FISCO
fly status --app medtrust-lite-fisco

# MPC
fly status --app medtrust-lite-mpc
```

---

## 🔧 配置说明

### 主应用 (API + Web)
```toml
[[vm]]
cpu_kind = "shared"
cpus = 1
memory_mb = 512          # 合并API和Web
auto_stop_machines = true  # 空闲时自动停止
min_machines_running = 0   # 最少0个实例
```

### FATE Flow (模拟版)
- 使用 Node.js 模拟 FATE API
- 返回预设的训练结果
- 适合演示联邦学习流程

### FISCO BCOS (单节点)
- 仅部署1个节点用于演示
- 使用临时存储，无需Volume
- 支持基本的存证功能

### MPC (模拟版)
- 使用 Node.js 模拟 MPC 计算
- 返回模拟的安全计算结果
- 适合演示隐私统计流程

---

## 💰 成本详情

```
月度成本估算 (按24/7运行):

服务              配置              月成本
─────────────────────────────────────────
medtrust-lite    shared-1x/512MB   ~$2
medtrust-fate    shared-1x/256MB   ~$1.5
medtrust-fisco   shared-1x/512MB   ~$2
medtrust-mpc     shared-1x/256MB   ~$1.5
Volume 1GB                         ~$0.15
─────────────────────────────────────────
总计                              ~$7.15

实际成本 (按4小时/天使用):
~$2-3/月
```

---

## ⚠️ 适用场景

### ✅ 适合使用 Lite 方案
- 产品演示
- 概念验证 (PoC)
- 开发测试
- 会议展示
- 预算受限

### ❌ 不适合使用 Lite 方案
- 生产环境真实数据
- 需要完整隐私计算功能
- 多节点区块链共识需求
- 高可用性要求

---

## 🔍 服务地址

部署完成后，服务可通过以下地址访问：

| 服务 | 地址 | 用途 |
|------|------|------|
| 主应用 | `https://medtrust-lite.fly.dev` | 前端+API |
| FATE | `https://medtrust-lite-fate.fly.dev` | 联邦学习API |
| FISCO | `http://medtrust-lite-fisco.fly.dev:8545` | 区块链RPC |
| MPC | `https://medtrust-lite-mpc.fly.dev` | MPC网关 |

---

## 🛠️ 自定义配置

### 修改内存限制
```toml
[[vm]]
cpu_kind = "shared"
cpus = 1
memory_mb = 512  # 改为需要的值: 256/512/1024
```

### 修改区域
```toml
primary_region = "hkg"  # 可选: hkg/nrt/lhr/iad
```

### 启用持久化存储
```toml
[mounts]
source = "my_data"
destination = "/data"
```
创建 Volume:
```bash
fly volumes create my_data --app medtrust-lite --size 1
```

---

## 📝 更新部署

```bash
# 更新主应用
fly deploy --app medtrust-lite --config fly.template.toml

# 更新特定服务
fly deploy --app medtrust-lite-fate --config fate-mock.toml
```

---

## 🗑️ 清理资源

```bash
# 删除所有 Lite 应用
fly apps destroy medtrust-lite
fly apps destroy medtrust-lite-fate
fly apps destroy medtrust-lite-fisco
fly apps destroy medtrust-lite-mpc

# 删除 Volume (如果有)
fly volumes list --app medtrust-lite
fly volumes delete <volume-id>
```

---

## 📊 与原方案对比

| 功能 | Full Setup | Lite Setup |
|------|------------|------------|
| 部署复杂度 | 高 (需构建) | 低 (预构建) |
| 启动时间 | 5-10分钟 | 30秒 |
| 资源占用 | 5GB+ 内存 | 1.5GB 内存 |
| 月成本 | ~$45 | ~$8 |
| FATE功能 | 完整 | 模拟 |
| 区块链 | 3节点 | 1节点 |
| 适用场景 | 生产 | 演示 |

---

## 📞 支持

如有问题，请查看：
- [成本分析文档](./COST_ANALYSIS.md)
- [Fly.io 文档](https://fly.io/docs/)
- 项目 Issues

---

*最后更新: 2026-02-13*
