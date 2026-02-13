## Claude Agent Teams 配置修正

### ❌ 错误配置 (已废弃)

```json
{
  "teamsmode": 1  // ❌ 不存在此配置
}
```

### ✅ 正确配置

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### 参考来源

**Claude Code 官方文档**: https://code.claude.com/docs/en/agent-teams

> Agent teams are disabled by default. Enable them by setting the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` environment variable to 1, either in your shell environment or through settings.json:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### 已更新文件

- ✅ `medtrust/.claude/settings.json`
- ✅ `medtrust/scripts/launch-teams.sh`
- ✅ `medtrust/docs/CLAUDE_AGENT_TEAMS.md`

### Agent Teams vs SubAgents 对比

| | SubAgents | Agent Teams |
|--|-----------|-------------|
| **名称** | subagents | agent-teams |
| **启用** | 默认启用 | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| **上下文** | 独立，结果返回主代理 | 完全独立 |
| **通信** | 单向 → 主代理 | 队友之间直接通信 |
| **协调** | 主代理管理 | 共享任务列表，自协调 |

---

*修正时间: 2026-02-11*
