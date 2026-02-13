# MedTrust Claude Agent Teams 配置完成

## ✅ 配置完成

### 配置文件结构

```
medtrust/.claude/
├── settings.json              # Agent Teams 配置 (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)
├── hooks/
│   ├── on-task-start.js      # 任务开始 Hook
│   ├── on-progress.js        # 进度更新 Hook (30s 节流)
│   ├── on-task-complete.js   # 任务完成 Hook
│   └── on-task-fail.js       # 任务失败 Hook
├── results/                   # 任务结果存储
└── tasks/                     # 任务元数据
```

### Teams 定义

| Team | 名称 | 专长 | 工作目录 |
|------|------|------|----------|
| `medtrust-frontend` | Frontend Team | React, Next.js, TypeScript, Tailwind | `apps/web/src` |
| `medtrust-backend` | Backend Team | NestJS, TypeORM, SQLite | `apps/api/src` |
| `medtrust-test` | QA Team | Jest, Testing Library, Playwright | `apps/*/test` |
| `medtrust-leader` | Tech Lead | 架构、协调、代码审查 | 只读 |

### Hooks 功能

- **on-task-start**: 任务开始时发送 Webhook 通知
- **on-progress**: 每 30 秒发送进度更新
- **on-task-complete**: 任务完成时发送结果摘要
- **on-task-fail**: 任务失败时发送错误信息

## 🚀 使用方法

### 快速启动

```bash
cd /root/.openclaw/workspace/projects/medtrust

# 启动 Frontend + Backend Teams
./scripts/launch-teams.sh frontend,backend slack:openclawgoly

# 启动所有 Teams
./scripts/launch-teams.sh frontend,backend,test,leader slack:openclawgoly
```

### 环境变量

```bash
# 必需
export OPENCLAW_WEBHOOK_URL="http://localhost:8080/webhook/claude"

# 可选 (用于 Slack 通知)
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

### 输出示例

```
========================================
  MedTrust Claude Teams Mode
========================================

[1/4] Checking configuration...
✅ Configuration OK

[2/4] Development Plan
  Teams: frontend,backend
  Notify: slack:openclawgoly

[3/4] Teams Configuration

  📋 MedTrust Frontend Team
     └─ Develops Next.js frontend for medical data platform

  📋 MedTrust Backend Team
     └─ Develops NestJS backend APIs for medical data platform

[4/4] Launching Teams
  Task ID: medtrust-20260211-a1b2c3d4

  🚀 Starting frontend team...
     └─ PID: 12345
  🚀 Starting backend team...
     └─ PID: 12346

========================================
  All Teams Launched!
========================================

Task ID: medtrust-20260211-a1b2c3d4

Monitoring Commands:
  📊 View logs:     tail -f .claude/output/medtrust-20260211-a1b2c3d4/*/output.log
  📈 Check status:  cat .claude/tasks/medtrust-20260211-a1b2c3d4.json
  🔍 List processes: ps aux | grep claude

Results will be saved to:
  📁 .claude/results/medtrust-20260211-a1b2c3d4-*.json

You will receive notifications when teams complete.
```

## 📊 监控任务

### 查看日志

```bash
# 查看所有 teams 的日志
tail -f .claude/output/${TASK_ID}/*/output.log

# 查看特定 team 的日志
tail -f .claude/output/${TASK_ID}/frontend/output.log
```

### 检查状态

```bash
# 查看任务元数据
cat .claude/tasks/${TASK_ID}.json

# 查看完成结果
ls -la .claude/results/
cat .claude/results/${TASK_ID}-complete.json
```

### 进程管理

```bash
# 查看运行的 Claude 进程
ps aux | grep claude

# 停止特定 team
kill $(cat .claude/output/${TASK_ID}/frontend/pid)
```

## 🔔 通知机制

### Webhook 通知

当任务开始/完成/失败时，会自动发送 POST 请求到:
- `${OPENCLAW_WEBHOOK_URL}/start`
- `${OPENCLAW_WEBHOOK_URL}/progress`
- `${OPENCLAW_WEBHOOK_URL}/complete`
- `${OPENCLAW_WEBHOOK_URL}/fail`

### Slack 通知

如果设置了 `SLACK_WEBHOOK_URL`，会自动发送 Slack 消息:
- 任务开始: 🚀
- 任务完成: ✅
- 任务失败: ❌

## 📝 任务结果格式

### 完成结果

```json
{
  "taskId": "medtrust-20260211-a1b2c3d4",
  "teamName": "MedTrust Frontend Team",
  "completedAt": "2026-02-11T10:30:00Z",
  "duration": 180000,
  "filesModified": [
    "apps/web/src/app/(dashboard)/compute/new/page.tsx",
    "apps/web/src/components/ComputeTaskForm.tsx"
  ],
  "summary": "Created compute task form and related components"
}
```

### 失败结果

```json
{
  "taskId": "medtrust-20260211-a1b2c3d4",
  "teamName": "MedTrust Backend Team",
  "failedAt": "2026-02-11T10:15:00Z",
  "error": {
    "message": "Failed to connect to Flower server",
    "code": "CONNECTION_ERROR"
  }
}
```

## 🎯 应用到 MedTrust Phase 2

### 启动命令

```bash
# Phase 2: Flower 联邦学习集成
cd /root/.openclaw/workspace/projects/medtrust
./scripts/launch-teams.sh backend

# Phase 2 + Frontend
cd /root/.openclaw/workspace/projects/medtrust
./scripts/launch-teams.sh frontend,backend
```

### Teams 任务分配

**Frontend Team**:
- 创建计算任务提交表单
- 创建计算结果展示页面
- 创建审计日志查看页面

**Backend Team**:
- 实现 Flower 集成服务
- 完成 Audit 模块
- 添加计算任务状态管理

**Test Team**:
- 编写 E2E 测试
- 编写 API 测试
- 编写组件测试

---

*配置完成时间: 2026-02-11*
*Claude Code Agent Teams: Enabled (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1)*
