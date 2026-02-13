# Aider 配置修复指南

## 问题原因
Aider 默认使用的模型 `claude-haiku-4-5-20251001` 在你的 API 端点不可用，导致 503 错误。

## 解决方案

### 已应用的修复

在项目目录创建了 `.aider.conf.yml`，配置为：
```yaml
openai-api-base: https://gaccode.com/claudecode
openai-api-key: sk-ant-oat01-ff00b5c7f3661b21f2dc775cda3aae61362eac2143a689bbacc1296fac3da812
model: anthropic/claude-3-5-sonnet-20241022
```

### 测试 Aider

```bash
cd /root/.openclaw/workspace/projects/medtrust

# 测试新配置
aider --version

# 简单测试
aider --yes --message "测试配置" README.md
```

### 如果仍有问题

**选项1**: 更新全局配置
```bash
# 编辑全局配置
cat > ~/.aider.conf.yml << 'EOF'
openai-api-base: https://gaccode.com/claudecode
openai-api-key: sk-ant-oat01-ff00b5c7f3661b21f2dc775cda3aae61362eac2143a689bbacc1296fac3da812
model: anthropic/claude-3-5-sonnet-20241022
stream: true
max-chat-history-tokens: 200000
EOF
```

**选项2**: 使用环境变量
```bash
export OPENAI_API_BASE=https://gaccode.com/claudecode
export OPENAI_API_KEY=sk-ant-oat01-ff00b5c7f3661b21f2dc775cda3aae61362eac2143a689bbacc1296fac3da812
aider --model anthropic/claude-3-5-sonnet-20241022
```

**选项3**: 直接使用命令行参数
```bash
aider \
  --openai-api-base https://gaccode.com/claudecode \
  --openai-api-key sk-ant-oat01-ff00b5c7f3661b21f2dc775cda3aae61362eac2143a689bbacc1296fac3da812 \
  --model anthropic/claude-3-5-sonnet-20241022 \
  --yes \
  --message "实现代码" apps/api/src/
```

## 备选方案

如果 Aider 仍然无法工作，当前项目已经**手动实现了核心后端模块**：

- ✅ Auth 模块 (JWT 认证)
- ✅ Tenant 模块 (租户管理)
- ✅ 基础架构 (Swagger, TypeORM)

可以继续手动开发或等待 Aider 配置修复。

---

*修复时间: 2026-02-10*
