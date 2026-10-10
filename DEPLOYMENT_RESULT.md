# MedTrust Lite 部署结果

## ✅ 部署状态：成功

所有服务已成功部署到 Fly.io (sin 区域)。

---

## 🌐 服务地址

| 服务 | 地址 | 状态 |
|------|------|------|
| **主应用 (带前端)** | https://medtrust-lite.fly.dev | ✅ 运行中 |
| **FATE Flow** | https://medtrust-lite-fate.fly.dev | ✅ 运行中 |
| **FISCO BCOS** | http://medtrust-lite-fisco.fly.dev:8545 | ⏸️ 空闲停止 |
| **MPC** | https://medtrust-lite-mpc.fly.dev | ✅ 运行中 |

---

## 🎨 前端界面

主应用现在包含完整的前端界面：

### 功能模块
1. **登录页面** - 支持快速选择演示账号
2. **仪表板** - 显示统计数据、最新资产、计算任务
3. **数据资产** - 浏览8个医疗数据资产
4. **计算任务** - 查看6个隐私计算任务状态

### 演示账号
点击登录页面的「快速选择演示账号」即可使用：
- **演示用户** - demo@medtrust.space
- **示范甲医院** - 数据提供方视角
- **研究院** - 数据消费方视角

密码统一为: `demo123456`

---

## 📊 部署的服务

### 1. 主应用 (medtrust-lite)
- **镜像**: Node.js 20 Alpine (47MB)
- **配置**: shared-cpu-1x, 256MB 内存
- **区域**: sin (新加坡)
- **副本**: 2 machines
- **功能**: API + Web 前端

### 2. FATE Flow (medtrust-lite-fate)
- **镜像**: Node.js 20 Alpine (45MB)
- **配置**: shared-cpu-1x, 256MB 内存
- **区域**: sin (新加坡)
- **副本**: 2 machines
- **功能**: 联邦学习模拟服务

### 3. FISCO BCOS (medtrust-lite-fisco)
- **镜像**: fiscoorg/fiscobcos:v3.6.0
- **配置**: shared-cpu-1x, 512MB 内存
- **区域**: sin (新加坡)
- **副本**: 2 machines
- **功能**: 区块链单节点演示

### 4. MPC (medtrust-lite-mpc)
- **镜像**: Node.js 20 Alpine (45MB)
- **配置**: shared-cpu-1x, 256MB 内存
- **区域**: sin (新加坡)
- **副本**: 2 machines
- **功能**: 多方安全计算模拟服务

---

## 💰 成本估算

### 月度成本 (按24/7运行)
```
服务              配置              成本
─────────────────────────────────────────
medtrust-lite    shared-1x/256MB   ~$1.5
medtrust-fate    shared-1x/256MB   ~$1.5
medtrust-fisco   shared-1x/512MB   ~$2
medtrust-mpc     shared-1x/256MB   ~$1.5
─────────────────────────────────────────
总计                              ~$6.5/月
```

### 实际成本 (按空闲自动停止)
```
每天使用4小时计算:
~$1-2/月
```

**节省**: 相比原方案 ($45/月)，节省约 **85%**

---

## 🔧 管理命令

### 查看状态
```bash
# 主应用
fly status --app medtrust-lite

# FATE
fly status --app medtrust-lite-fate

# FISCO
fly status --app medtrust-lite-fisco

# MPC
fly status --app medtrust-lite-mpc
```

### 查看日志
```bash
fly logs --app medtrust-lite -n
```

### 重启服务
```bash
fly restart --app medtrust-lite
```

### 停止所有服务
```bash
fly scale count 0 --app medtrust-lite
fly scale count 0 --app medtrust-lite-fate
fly scale count 0 --app medtrust-lite-fisco
fly scale count 0 --app medtrust-lite-mpc
```

---

## 🧪 API 测试

### 主应用 API
```bash
# 健康检查
curl https://medtrust-lite.fly.dev/health

# 获取租户列表
curl https://medtrust-lite.fly.dev/api/tenants

# 获取数据资产
curl https://medtrust-lite.fly.dev/api/assets

# 获取计算任务
curl https://medtrust-lite.fly.dev/api/compute-tasks

# 获取统计数据
curl https://medtrust-lite.fly.dev/api/stats
```

### FATE Flow API
```bash
# 版本信息
curl https://medtrust-lite-fate.fly.dev/v1/version

# 提交任务
curl -X POST https://medtrust-lite-fate.fly.dev/v1/job/submit \
  -H "Content-Type: application/json" \
  -d '{"dsl": {}, "conf": {}}'
```

### MPC API
```bash
# 健康检查
curl https://medtrust-lite-mpc.fly.dev/health

# 安全求和
curl -X POST https://medtrust-lite-mpc.fly.dev/compute/sum \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "test", "shares": [{"value": 100}, {"value": 200}]}'
```

---

## ⚠️ 注意事项

1. **FISCO BCOS** 目前处于 stopped 状态，首次访问时会自动启动 (auto_start_machines = true)

2. **空闲停止**: 所有服务都配置了 `auto_stop_machines = true`，空闲一段时间后会自动停止以节省成本

3. **演示数据**: 所有服务都使用模拟数据，重启后数据会重置

4. **前端缓存**: 如果页面显示异常，尝试强制刷新 (Ctrl+F5 或 Cmd+Shift+R)

5. **区域延迟**: 部署在 sin (新加坡)，国内访问可能有短暂延迟

---

## 🗑️ 清理资源

如需删除所有部署：
```bash
fly apps destroy medtrust-lite
fly apps destroy medtrust-lite-fate
fly apps destroy medtrust-lite-fisco
fly apps destroy medtrust-lite-mpc
```

---

## 📝 更新记录

- **2026-02-13** - 添加前端界面，修复 Express 路由问题
- **2026-02-13** - 初始部署完成

---

*部署时间: 2026-02-13*
*部署区域: sin (新加坡)*
