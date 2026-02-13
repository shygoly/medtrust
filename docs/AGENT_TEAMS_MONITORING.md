# Agent Teams Hooks / 监控配置完成 ✅

## 配置状态

| 组件 | 状态 | 说明 |
|------|------|------|
| Agent Teams 配置 | ✅ | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| Teams 定义 | ✅ | frontend, backend, test, leader |
| 监控脚本 | ✅ | `scripts/monitor-agent-teams.js` |
| 启动脚本 | ✅ | `scripts/launch-teams.sh` |

## 架构说明

由于 **Claude Code Agent Teams 不支持原生 hooks 配置**，我们使用 **OpenClaw 监控机制** 实现类似功能：

```
┌─────────────────────────────────────────────────────────────┐
│                    监控架构                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User → launch-teams.sh                                     │
│            │                                                │
│            ├── Spawn Claude Agent Teams                     │
│            │       ├── Frontend Team (background)           │
│            │       ├── Backend Team (background)            │
│            │       └── ...                                  │
│            │                                                │
│            └── Start Monitor (background)                   │
│                    │                                        │
│                    ├── 30s 轮询检查输出文件                  │
│                    ├── 检测完成状态                          │
│                    ├── 发送 Webhook 通知                     │
│                    └── 发送 Slack 通知                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 监控功能

### 事件触发

| 事件 | 触发时机 | 通知方式 |
|------|---------|---------|
| **start** | 监控开始时 | Webhook |
| **progress** | 每 30 秒 | Webhook |
| **complete** | 所有 teams 完成 | Webhook + Slack |

### Webhook 端点

```
POST ${OPENCLAW_WEBHOOK_URL}/start     # 任务开始
POST ${OPENCLAW_WEBHOOK_URL}/progress  # 进度更新
POST ${OPENCLAW_WEBHOOK_URL}/complete  # 任务完成
```

### 通知内容示例

**进度通知**:
```json
{
  "taskId": "medtrust-20260211-a1b2c3d4",
  "progress": {
    "frontend": { "exists": true, "isComplete": false, "lines": 150 },
    "backend": { "exists": true, "isComplete": true, "lines": 320 }
  },
  "timestamp": "2026-02-11T08:30:00Z"
}
```

**完成通知**:
```json
{
  "taskId": "medtrust-20260211-a1b2c3d4",
  "project": "medtrust",
  "status": "completed",
  "results": {
    "teams": {
      "frontend": { "logSize": 5000, "hasErrors": false },
      "backend": { "logSize": 8000, "hasErrors": false }
    }
  }
}
```

## 文件结构

```
medtrust/.claude/
├── settings.json              # Agent Teams 配置
├── output/
│   └── ${TASK_ID}/
│       ├── frontend/
│       │   ├── output.log     # Claude 输出
│       │   └── pid            # 进程 ID
│       ├── backend/
│       │   └── ...
│       └── monitor.log        # 监控日志
├── results/                   # 结果摘要
└── tasks/
    └── ${TASK_ID}.json        # 任务元数据
```

## 使用方法

### 1. 设置环境变量

```bash
export OPENCLAW_WEBHOOK_URL="http://localhost:8080/webhook/claude"
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

### 2. 启动 Agent Teams

```bash
cd /root/.openclaw/workspace/projects/medtrust
./scripts/launch-teams.sh frontend,backend slack:openclawgoly
```

### 3. 监控输出

```bash
# 查看监控日志
tail -f .claude/output/${TASK_ID}/monitor.log

# 查看所有 teams 日志
tail -f .claude/output/${TASK_ID}/*/output.log

# 查看特定 team 日志
tail -f .claude/output/${TASK_ID}/frontend/output.log
```

## 为什么不用 Claude Code 原生 Hooks?

Claude Code 原生 hooks (`.claude/hooks/`) 仅支持以下事件：
- `pre-command` / `post-command`
- `pre-edit` / `post-edit`
- `on-start` / `on-exit`
- `on-input`

这些 hooks 是针对 **单个 Claude Code 会话** 的，不支持 **Agent Teams** 的跨会话事件。

我们的解决方案：
- ✅ 使用 OpenClaw 监控 Agent Teams 的输出文件
- ✅ 30s 轮询检测完成状态
- ✅ 自动发送 Webhook / Slack 通知
- ✅ 不依赖 Claude Code 内部机制

## 下一步

运行测试：
```bash
./scripts/launch-teams.sh backend
```

---

*配置完成时间: 2026-02-11*
