# MedTrust Lite 成本分析

## 📊 优化前后对比

### 原始配置 (Full Setup)

| 服务 | VM类型 | CPU | 内存 | 存储 | 月成本 | 备注 |
|------|--------|-----|------|------|--------|------|
| FATE Flow | 默认 | 1 | 1GB+ | - | ~$10 | 完整版容器 |
| FISCO BCOS x3 | 默认 | 1x3 | 1GBx3 | 10GBx3 | ~$30 | 3节点+3个Volume |
| MP-SPDZ | 默认 | 1 | 1GB+ | - | ~$5 | 需构建 |
| **总计** | - | **4** | **5GB+** | **30GB** | **~$45/月** | - |

### 优化配置 (Lite Setup)

| 服务 | VM类型 | CPU | 内存 | 存储 | 月成本 | 备注 |
|------|--------|-----|------|------|--------|------|
| 主应用 | shared-cpu-1x | 1 | 512MB | 1GB | ~$2 | 合并API+Web |
| FATE Mock | shared-cpu-1x | 1 | 256MB | - | ~$1.5 | 模拟服务 |
| FISCO 单节点 | shared-cpu-1x | 1 | 512MB | - | ~$2 | 演示用单节点 |
| MPC Lite | shared-cpu-1x | 1 | 256MB | - | ~$1.5 | 模拟服务 |
| **总计** | - | **4** | **1.5GB** | **1GB** | **~$7/月** | **节省84%** |

---

## 💰 详细成本计算

### Fly.io 定价参考 (2026)

| 资源类型 | 价格 | 说明 |
|----------|------|------|
| shared-cpu-1x | ~$1.94/月 | 最便宜的VM |
| 256MB 内存 | 基础 | 包含在VM中 |
| 512MB 内存 | +$0 | 稍高配置 |
| Volume (1GB) | ~$0.15/月 | 持久化存储 |
| 出站流量 | 前160GB/月免费 | 超出$0.02/GB |

### 优化方案月度成本

```
基础成本:
  shared-cpu-1x x 4 = $7.76/月
  Volume 1GB = $0.15/月
  
小计: ~$8/月

流量成本 (估算):
  演示环境月流量 < 10GB = $0

总计: ~$8/月
```

---

## 🎯 优化策略

### 1. VM 优化
```toml
[[vm]]
cpu_kind = "shared"  # 使用共享CPU
cpus = 1
memory_mb = 256      # 最小内存
```

### 2. 自动启停
```toml
[http_service]
auto_stop_machines = true   # 空闲时停止
auto_start_machines = true  # 请求时启动
min_machines_running = 0    # 最少0个实例
```

**节省效果**: 演示环境每天使用4小时，可节省约 70% 费用

### 3. 服务合并
- 原方案: API 和 Web 分开部署 → 2个应用
- 优化后: API 和 Web 合并 → 1个应用

**节省**: 减少 1 个 VM

### 4. 模拟服务替代
| 原服务 | 优化方案 | 内存节省 |
|--------|----------|----------|
| FATE Flow (完整版) | Node.js 模拟服务 | ~2GB |
| MP-SPDZ (完整编译) | Node.js 模拟服务 | ~1GB |
| FISCO BCOS (3节点) | 单节点演示版 | ~2GB |

### 5. 去除 Volume
- 原方案: 3个 FISCO 节点各需 10GB Volume
- 优化后: 使用临时存储，数据可重置

**节省**: ~$4.5/月 (Volume费用)

---

## 🚀 部署命令

### 快速部署
```bash
cd fly-services/lite

# 一键部署全部服务
chmod +x deploy.sh
./deploy.sh
```

### 单独部署
```bash
# 仅部署主应用
fly deploy --app medtrust-lite --config fly.template.toml

# 仅部署 FATE 模拟
fly deploy --app medtrust-lite-fate --config fate-mock.toml

# 仅部署 FISCO
fly deploy --app medtrust-lite-fisco --config fisco-single.toml

# 仅部署 MPC
fly deploy --app medtrust-lite-mpc --config mpc-lite.toml
```

---

## 📈 成本监控

### 查看实时成本
```bash
# 查看应用列表和资源使用
fly status --app medtrust-lite

# 查看账单
fly billing show
```

### 设置成本警告
建议设置月度预算 $10，当接近限制时接收通知。

---

## 🔧 进一步优化建议

### 1. 使用 WireGuard (免费内网)
```bash
# 创建 WireGuard 隧道，服务间通信走内网
fly wireguard create
```

### 2. 数据库优化
```bash
# 使用 SQLite 代替 PostgreSQL
# 已经内置在主应用中，无需额外数据库服务
```

### 3. 静态资源 CDN
```bash
# 使用 Fly.io 的免费 CDN 加速静态资源
# 在 fly.toml 中配置:
[cdn]
  statics = ["/static"]
```

### 4. 定期清理
```bash
# 设置定时任务清理日志和临时文件
# 减少存储使用
```

---

## ⚠️ 注意事项

### 优化方案的局限性

| 方面 | 原方案 | Lite方案 |
|------|--------|----------|
| FATE 功能 | 完整 | 模拟演示 |
| FISCO 节点 | 3节点联盟链 | 单节点 |
| MPC 计算 | 真实计算 | 模拟计算 |
| 适用场景 | 生产环境 | 演示/PoC |
| 数据持久化 | 完整 | 可重置 |

### 何时使用原方案
- 真实数据生产环境
- 需要完整隐私计算功能
- 多节点区块链共识
- 高可用性要求

### 何时使用 Lite 方案
- 产品演示
- 概念验证 (PoC)
- 开发测试
- 预算有限

---

## 📋 一键启动脚本

```bash
#!/bin/bash
# 创建最小成本演示环境

# 1. 创建应用 (如果还没有)
fly apps create medtrust-lite --org personal 2>/dev/null || true
fly apps create medtrust-lite-fate --org personal 2>/dev/null || true
fly apps create medtrust-lite-fisco --org personal 2>/dev/null || true
fly apps create medtrust-lite-mpc --org personal 2>/dev/null || true

# 2. 部署全部服务
cd fly-services/lite
./deploy.sh

echo "✅ 部署完成！月成本约 $8"
```

---

## 📞 成本优化咨询

如需进一步优化:
1. 使用 Fly.io 的 Autoscaling 自动扩缩容
2. 考虑使用 Spot 实例 (抢占式)
3. 评估是否需要所有服务 24/7 运行
4. 定期审查未使用的 Volume 和 Images

---

*最后更新: 2026-02-13*
*成本基于 Fly.io 2026年定价*
