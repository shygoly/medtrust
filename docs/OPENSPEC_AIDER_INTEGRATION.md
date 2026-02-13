# OpenSpec + Aider 集成方案

> 将 OpenSpec 规范转换为 Aider 提示词，实现规范驱动的 AI 编程

---

## 架构概览

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   OpenSpec      │ ───► │   Aider Bridge   │ ───► │     Aider       │
│   (规范定义)     │      │   (提示词转换)    │      │   (代码生成)     │
└─────────────────┘      └──────────────────┘      └─────────────────┘
        │                         │                        │
        ▼                         ▼                        ▼
   proposal.md              .aider-prompts/           生成的代码
   changes/
   └── specs/
       └── */spec.md
```

---

## 工作流程

### 1. 定义规范 (OpenSpec)

```bash
openspec/
├── proposal.md              # 项目提案
├── config.yaml              # 技术栈配置
└── changes/
    └── monorepo-init/       # 变更集
        └── specs/
            ├── database-schema/
            │   └── spec.md  # 数据库规范
            ├── nestjs-backend/
            │   └── spec.md  # 后端规范
            └── nextjs-frontend/
                └── spec.md  # 前端规范
```

### 2. 转换提示词 (Bridge)

```bash
# 运行转换脚本
node scripts/openspec-aider-bridge.js

# 生成内容
.aider-prompts/
├── monorepo-init-database-schema.md
├── monorepo-init-nestjs-backend.md
├── monorepo-init-nextjs-frontend.md
└── ...
```

### 3. 执行代码生成 (Aider)

```bash
# 方式1: 批量执行
./scripts/aider-batch.sh

# 方式2: 单独执行
aider --yes --message "$(cat .aider-prompts/monorepo-init-nestjs-backend.md)" apps/api/src/
```

---

## 使用指南

### 快速开始

```bash
# 1. 确保在 medtrust 目录
cd /root/.openclaw/workspace/projects/medtrust

# 2. 生成 Aider 提示词
node scripts/openspec-aider-bridge.js

# 3. 查看生成的提示词
cat .aider-prompts/monorepo-init-nestjs-backend.md

# 4. 使用 Aider 实现
aider --yes --message "$(cat .aider-prompts/monorepo-init-nestjs-backend.md)" apps/api/src/
```

### 批量执行

```bash
# 执行所有提示词
./scripts/aider-batch.sh
```

### 自定义提示词

编辑 `.aider-prompts/*.md` 文件，添加：
- 额外的上下文信息
- 特定的代码约束
- 项目特定的模式

---

## 提示词结构

转换后的 Aider 提示词包含：

```markdown
## Implementation Task

需求列表（从 spec 提取）
1. Requirement 1
   - Scenario A
   - Scenario B
2. Requirement 2
   ...

## Target Files

目标目录/文件

## Implementation Guidelines

1. Follow the project's existing code patterns
2. Use TypeScript with proper type definitions
3. Include comprehensive error handling
4. Add appropriate comments and documentation
5. Write clean, maintainable code
6. Consider edge cases and validation
7. Use dependency injection where applicable

## Acceptance Criteria

- All requirements are implemented
- Code compiles without errors
- Basic functionality works as described
- Follows project architecture patterns

## Requirements Detail

详细的 spec 内容（供参考）
```

---

## 集成优势

| 特性 | OpenSpec | Aider | 集成后 |
|------|----------|-------|--------|
| **规范定义** | ✅ 结构化 | ❌ 无 | ✅ 保留 |
| **版本控制** | ✅ Git 追踪 | ⚠️ 临时 | ✅ 完整历史 |
| **可追溯性** | ✅ 需求→代码 | ⚠️ 需手动 | ✅ 自动关联 |
| **批量执行** | ❌ 不支持 | ⚠️ 需脚本 | ✅ 一键执行 |
| **代码质量** | ❌ 不保证 | ✅ AI 生成 | ✅ 规范驱动 |

---

## 最佳实践

### 1. 先写 Spec，再生成代码

```bash
# 顺序执行
1. 编辑 openspec/changes/*/specs/*/spec.md
2. node scripts/openspec-aider-bridge.js
3. ./scripts/aider-batch.sh
```

### 2. 增量开发

```bash
# 只更新变更的 spec
node scripts/openspec-aider-bridge.js

# 只执行特定的提示词
aider --yes --message "$(cat .aider-prompts/monorepo-init-database-schema.md)" packages/database/
```

### 3. 代码审查

```bash
# 生成但不自动应用
aider --message "$(cat .aider-prompts/xxx.md)" <files>

# 手动审查后再确认
```

---

## 文件结构

```
medtrust/
├── openspec/                    # OpenSpec 规范
│   ├── proposal.md
│   └── changes/
│       └── monorepo-init/
│           └── specs/
│               ├── database-schema/spec.md
│               ├── nestjs-backend/spec.md
│               └── ...
│
├── .aider-prompts/              # 生成的 Aider 提示词
│   ├── monorepo-init-database-schema.md
│   ├── monorepo-init-nestjs-backend.md
│   └── ...
│
├── scripts/                     # 集成脚本
│   ├── openspec-aider-bridge.js    # 转换器
│   ├── openspec-to-aider.sh        # Bash 版本
│   └── aider-batch.sh              # 批量执行
│
└── apps/ packages/              # 生成的代码
```

---

## 故障排查

### 提示词生成失败

```bash
# 检查 spec 文件格式
head openspec/changes/*/specs/*/spec.md

# 确保 YAML frontmatter 正确
---
```

### Aider 执行失败

```bash
# 检查 Aider 安装
which aider
aider --version

# 检查目标文件存在
ls -la apps/api/src/
```

### 代码不符合预期

1. 检查 `.aider-prompts/*.md` 内容
2. 添加更多约束到 spec
3. 使用 `--no-auto-commits` 手动审查

---

## 扩展计划

- [ ] 支持自定义提示词模板
- [ ] 集成 Claude Code 作为备选
- [ ] 自动生成测试用例
- [ ] 代码生成后的自动验证
- [ ] CI/CD 集成

---

*集成方案版本: v1.0*
*创建时间: 2026-02-10*
