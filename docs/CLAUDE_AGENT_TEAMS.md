# MedTrust Claude Agent Teams 配置

## ✅ 正确配置完成

根据 Claude Code 官方文档，正确的配置名称是 **"Agent Teams"** (实验性功能)。

### 官方启用方式

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

或环境变量：
```bash
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
```

### 配置文件

**位置**: `medtrust/.claude/settings.json`

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "teams": {
    "medtrust-frontend": { ... },
    "medtrust-backend": { ... },
    "medtrust-test": { ... },
    "medtrust-leader": { ... }
  }
}
```

### Agent Teams vs SubAgents

| 特性 | SubAgents | Agent Teams |
|------|-----------|-------------|
| 上下文 | 独立上下文，结果返回给调用者 | 独立上下文，完全独立 |
| 通信 | 只向主代理报告结果 | 队友之间直接通信 |
| 协调 | 主代理管理所有工作 | 共享任务列表，自协调 |
| 适用场景 | 只需要结果的任务 | 需要讨论和协作的复杂工作 |
| Token 成本 | 较低 | 较高 |

### 启动方式

Agent Teams 不需要特殊的命令行参数，只需启用环境变量后，告诉 Claude 创建一个 agent team：

```bash
# 设置环境变量
export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

# 启动 Claude Code
cd /root/.openclaw/workspace/projects/medtrust
claude

# 然后告诉 Claude:
# "Create an agent team to develop MedTrust Phase 2 features: 
#  frontend teammate for UI components, 
#  backend teammate for Flower integration"
```

### Teams 定义

| Team ID | 名称 | 角色 |
|---------|------|------|
| `medtrust-frontend` | Frontend Team | UI 开发 |
| `medtrust-backend` | Backend Team | API 开发 |
| `medtrust-test` | QA Team | 测试 |
| `medtrust-leader` | Tech Lead | 协调审查 |

### 工作流程

```
User -> Lead Agent (Claude)
         ├── Spawn Frontend Teammate
         ├── Spawn Backend Teammate
         └── Spawn Test Teammate
         
         (Teammates work independently, communicate via shared task list)
         
         Lead synthesizes results
         └── Reports to User
```

### 控制方式

- **Shift+Up/Down**: 选择队友直接对话
- **自然语言**: 告诉 lead 分配任务
- **共享任务列表**: 队友自协调

### 最佳实践

1. **适合 Agent Teams**:
   - 研究和审查 (多角度探索)
   - 新模块/功能 (各部分独立)
   - 调试 (竞争假设)
   - 跨层协调 (前端/后端/测试)

2. **不适合 Agent Teams**:
   - 顺序任务
   - 同一文件编辑
   - 依赖关系复杂

### 相关文档

- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code Settings](https://code.claude.com/docs/en/settings)

---

*配置更新时间: 2026-02-11*
*Claude Code Agent Teams (Experimental)*
