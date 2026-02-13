# Claude Code Hooks 配置

## 目录结构

```
.claude/
├── hooks/
│   ├── pre-command          # 命令执行前
│   ├── post-command         # 命令执行后
│   ├── pre-edit             # 编辑文件前
│   ├── post-edit            # 编辑文件后
│   ├── on-start             # 会话开始时
│   ├── on-exit              # 会话结束时
│   ├── on-input             # 等待用户输入时
│   └── notify               # 通知事件
├── settings.json
└── ...
```

## 官方文档

- https://code.claude.com/docs/en/hooks-guide
- https://code.claude.com/docs/en/hooks (Hooks reference)

## 重要说明

Claude Code 的 hooks 有两种类型：

### 1. Shell Command Hooks
放置在 `.claude/hooks/` 目录下的可执行脚本，以事件名称命名：
- `pre-command` - 在 Claude 执行命令前运行
- `post-command` - 在 Claude 执行命令后运行
- `pre-edit` - 在编辑文件前运行
- `post-edit` - 在编辑文件后运行
- `on-start` - 会话开始时运行
- `on-exit` - 会话结束时运行
- `on-input` - 等待用户输入时运行

### 2. Agent-based Hooks (实验性)
使用特定事件触发，通过配置文件定义。

## 我们的实现

我们使用的是 **Agent Teams** 的自定义 hooks，这些不是 Claude Code 原生的 hook 事件。

对于 Agent Teams，我们应该使用 **Agent-based hooks** 或 **自定义 webhook 回调**。

## 建议方案

### 方案 A: 使用 Claude Code 原生 Hooks

创建 `.claude/hooks/` 目录下的可执行脚本：

```bash
# .claude/hooks/post-edit
#!/bin/bash
# 在每次编辑后发送通知
curl -X POST $OPENCLAW_WEBHOOK_URL ...
```

### 方案 B: 使用 Agent Teams 的事件系统

Agent Teams 有内置的事件系统， teammates 可以发送消息给彼此。

### 方案 C: 使用 OpenClaw 的监控机制

不依赖 Claude Code hooks，而是使用 OpenClaw 的 sessions_spawn + 轮询机制。

## 当前配置

我们的 `settings.json` 中配置的 `hooks` 对象是自定义的，Claude Code 不会自动识别这些。

我们需要修改为以下方案之一：

1. **Claude Code 原生 hooks** - 使用 `post-edit`, `on-exit` 等
2. **Agent Teams 事件** - 在 Agent Teams 模式下使用 teammate 消息
3. **OpenClaw 监控** - 使用 OpenClaw 的 session 监控机制

## 推荐: 方案 3 (OpenClaw 监控)

由于 Claude Code 的 hooks 机制主要是针对本地交互式使用，对于异步 Agent Teams，使用 OpenClaw 的监控机制更可靠。

已实现的监控脚本：`scripts/launch-teams.sh`

---

*文档更新时间: 2026-02-11*
