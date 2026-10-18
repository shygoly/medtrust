# AI Chat Agent - Specification

## 1. 概述

为 MedTrust 可信空间提供对话式 AI Agent，通过自然语言交互引导用户配置和提交多方安全计算任务。

## 2. 目标

### 2.1 用户目标
- 通过对话描述计算需求，无需理解技术细节
- 获得场景推荐和参数配置指导
- 一次对话完成任务提交

### 2.2 系统目标
- 统一的任务配置入口，减少 UI 开发成本
- 支持快速添加新场景（医疗、电力、金融等）
- 可追溯的配置历史（对话即文档）

## 3. 范围

### 3.1 包含
- 对话式任务配置
- Card Message 表单交互
- 场景推荐
- 参数验证
- 任务提交到 MDOP API
- 会话管理

### 3.2 不包含
- 任务执行监控（已有独立系统）
- 数据集上传（由数据产品模块负责）
- 结果分析（由结果查看模块负责）

## 4. 功能需求

### FR-1: 场景识别
**描述**：Agent 能够理解用户需求并推荐合适的计算场景

**输入**：
- 用户自然语言描述：「我想对比两组患者的疗效」

**输出**：
- 推荐场景：「单臂试验外部对照」
- 场景说明：试验组与对照组分层匹配分析
- 下一步引导：需要配置试验方、对照方等信息

**验收标准**：
- 医疗场景识别准确率 > 90%（单臂对比、L4 FL、队列计数）
- 电力场景识别准确率 > 90%（负荷预测、需求响应、窃电检测）

### FR-2: 参数收集
**描述**：通过 Card Message 收集结构化参数

**Card 类型**：
1. **FormCard**：参数输入表单
2. **SelectCard**：下拉选择（参与方、数据产品）
3. **ConfirmCard**：提交前确认

**示例 - 单臂对照 FormCard**：
```json
{
  "type": "form",
  "title": "外部对照配置",
  "description": "配置试验组和对照组的匹配参数",
  "fields": [
    {
      "name": "trial",
      "label": "试验方",
      "type": "select",
      "options": [/* 从空间成员加载 */],
      "required": true
    },
    {
      "name": "controls",
      "label": "对照方",
      "type": "select",
      "options": [/* 从空间成员加载 */],
      "required": true
    },
    {
      "name": "strataKeys",
      "label": "分层键",
      "type": "text",
      "placeholder": "例如: <40|M, 40+|F",
      "help": "按年龄和性别分层",
      "required": true
    },
    {
      "name": "caliperDays",
      "label": "卡尺天数",
      "type": "number",
      "default": 30,
      "min": 1,
      "max": 365
    },
    {
      "name": "ratioK",
      "label": "匹配比例",
      "type": "number",
      "default": 2,
      "min": 1,
      "max": 10,
      "help": "对照:试验 = K:1"
    }
  ]
}
```

**验收标准**：
- 必填字段验证
- 试验方 ≠ 对照方
- 分层键格式验证
- Card 渲染正确

### FR-3: 任务提交
**描述**：将配置好的参数提交到对应的 MDOP API

**支持的场景**：
| 场景 | API 端点 | 模板 ID |
|------|---------|---------|
| 单臂对照 | POST /mdop/jobs/external-control | rws.external-control |
| L4 FL | POST /mdop/jobs/fl-prediction | mdop.l4-fl |
| 负荷预测 | POST /mdop/jobs/load-forecast | power.load-forecast |
| 需求响应 | POST /mdop/jobs/demand-response | power.demand-response |
| 窃电检测 | POST /mdop/jobs/theft-detection | power.theft-detection |

**API 调用示例**：
```typescript
POST /api/v1/mdop/jobs/external-control
Authorization: Bearer <token>
Content-Type: application/json

{
  "purpose": "外部对照 RWS",
  "applicant": { "org": "sponsor-a", "project": "p-1" },
  "contracts": ["ct-1"],
  "trial": { "participantId": "p-sponsor", "dataProductId": "dp-trial" },
  "controls": { "participantId": "p-hosp-a", "dataProductId": "dp-controls" },
  "teeNode": "urn:tds:sh-med:participant:tee-node-a",
  "strataKeys": ["<40|M", "40+|F"],
  "caliperDays": 30,
  "ratioK": 2,
  "minCell": 5,
  "notBefore": "2026-01-01T00:00:00Z",
  "notAfter": "2026-12-31T00:00:00Z"
}
```

**返回**：
```json
{
  "jobId": "job-12345",
  "status": "submitted",
  "template": "rws.external-control",
  "stages": 6
}
```

**验收标准**：
- 提交成功率 > 99%
- 返回有效的任务 ID
- 任务状态可追踪

### FR-4: 会话管理
**描述**：管理用户的对话会话

**会话结构**：
```typescript
interface Session {
  id: string;
  userId: string;
  spaceId: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string | CardMessage;
  timestamp: Date;
  toolCalls?: ToolCall[];
}
```

**会话生命周期**：
- 创建：用户首次发送消息
- 更新：每次对话
- 过期：24 小时无活动自动清理
- 持久化：存储到 PostgreSQL

**验收标准**：
- 会话上下文正确保留
- 支持多轮对话
- 会话可恢复

### FR-5: 错误处理
**描述**：友好的错误提示和恢复

**错误场景**：
1. **参数验证失败**：「分层键格式不正确，请使用 <40|M, 40+|F 格式」
2. **API 调用失败**：「任务提交失败，请稍后重试」
3. **权限不足**：「您没有权限访问该参与方的数据」
4. **场景不支持**：「该场景暂未开放，敬请期待」

**验收标准**：
- 错误信息清晰友好
- 提供恢复建议
- 不暴露技术细节

## 5. 非功能需求

### NFR-1: 性能
- 对话响应时间 < 2s（P95）
- Card 渲染时间 < 500ms
- 支持 100 并发会话

### NFR-2: 可用性
- 对话界面直观易用
- 移动端自适应
- 支持快捷键（Enter 发送）

### NFR-3: 可扩展性
- 新增场景无需修改核心代码
- 支持插件式 Tool 注册
- Card 模板可复用

### NFR-4: 安全性
- 所有 API 调用需要认证
- 会话数据加密存储
- 不在日志中记录敏感参数

### NFR-5: 可观测性
- 对话轮次追踪
- Tool 调用日志
- 场景使用统计

## 6. 用户故事

### US-1: 首次使用
```
作为 医药研发人员
我想 通过对话配置外部对照分析
以便 无需学习复杂的技术参数

场景：
1. 打开 Chat Agent 界面
2. 输入：「我想对比试验组和对照组的疗效」
3. Agent 推荐：「单臂试验外部对照」
4. 填写 FormCard：选择参与方、配置分层键
5. 确认并提交
6. 获得任务 ID 和追踪链接
```

### US-2: 多场景对比
```
作为 空间管理员
我想 了解不同场景的适用条件
以便 选择最合适的分析方法

场景：
1. 输入：「我有两家医院的数据，想做预测模型」
2. Agent 推荐：
   - L4 联邦学习（适合多方协同训练）
   - 单臂对照（适合疗效对比）
3. 询问 Agent：「这两种有什么区别？」
4. Agent 解释场景特点和适用条件
5. 选择场景并继续配置
```

### US-3: 电力场景
```
作为 电力调度员
我想 配置负荷预测任务
以便 优化电网调度

场景：
1. 输入：「我想预测明天的电力负荷」
2. Agent 推荐：「负荷预测」
3. 填写 FormCard：
   - 选择参与方（多个配电公司）
   - 预测周期：24 小时
   - 历史数据：30 天
4. 提交任务
5. 查看预测曲线
```

## 7. 接口定义

### 7.1 Chat API

```typescript
// POST /api/v1/chat
interface ChatRequest {
  message: string;
  sessionId?: string;
  spaceId: string;
}

interface ChatResponse {
  sessionId: string;
  message: Message;
  suggestions?: string[];  // 推荐的下一步操作
}

// GET /api/v1/chat/sessions
interface ListSessionsResponse {
  sessions: Session[];
  total: number;
}

// GET /api/v1/chat/sessions/:id
interface GetSessionResponse {
  session: Session;
}

// DELETE /api/v1/chat/sessions/:id
interface DeleteSessionResponse {
  success: boolean;
}
```

### 7.2 Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ParameterSchema>;
    required?: string[];
  };
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
}

interface ToolContext {
  userId: string;
  spaceId: string;
  sessionId: string;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
```

### 7.3 Card Message Interface

```typescript
interface CardMessage {
  type: 'form' | 'status' | 'result' | 'confirm';
  title: string;
  description?: string;
  fields?: FormField[];
  data?: Record<string, unknown>;
  actions?: CardAction[];
}

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'checkbox';
  placeholder?: string;
  help?: string;
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
  defaultValue?: unknown;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    message?: string;
  };
}

interface CardAction {
  label: string;
  type: 'submit' | 'cancel' | 'back';
  variant?: 'primary' | 'secondary' | 'danger';
}
```

## 8. 数据模型

### 8.1 数据库 Schema

```sql
-- 会话表
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  space_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  INDEX idx_user_space (user_id, space_id),
  INDEX idx_expires (expires_at)
);

-- 消息表
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content JSONB NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_session (session_id, created_at)
);

-- Tool 调用日志
CREATE TABLE tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  tool_name VARCHAR(255) NOT NULL,
  parameters JSONB NOT NULL,
  result JSONB,
  error TEXT,
  duration_ms INT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  INDEX idx_tool_name (tool_name, created_at)
);
```

## 9. 测试策略

### 9.1 单元测试
- PiAgent 核心逻辑
- Tool 执行逻辑
- Card 渲染组件
- 参数验证

### 9.2 集成测试
- Agent + Tools 集成
- API 端点
- 数据库操作

### 9.3 E2E 测试（Playwright）
- 完整对话流程
- Card 交互
- 任务提交
- 错误处理

### 9.4 性能测试
- 并发会话
- 响应时间
- 内存占用

## 10. 部署

### 10.1 环境变量
```env
# LLM
ANTHROPIC_API_KEY=sk-ant-xxxxx
LLM_MODEL=claude-3-5-sonnet-20241022
LLM_MAX_TOKENS=4096

# MedTrust API
MEDTRUST_API_URL=http://localhost:3000
MEDTRUST_API_TIMEOUT=30000

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/medtrust
REDIS_URL=redis://localhost:6379

# Server
PORT=4000
NODE_ENV=production
LOG_LEVEL=info

# Session
SESSION_TTL_HOURS=24
SESSION_CLEANUP_INTERVAL_HOURS=1
```

### 10.2 Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 4000
CMD ["node", "dist/main.js"]
```

### 10.3 Kubernetes
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chat-agent
spec:
  replicas: 3
  selector:
    matchLabels:
      app: chat-agent
  template:
    spec:
      containers:
      - name: chat-agent
        image: medtrust/chat-agent:latest
        ports:
        - containerPort: 4000
        env:
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: chat-agent-secrets
              key: anthropic-api-key
```

## 11. 监控指标

### 11.1 业务指标
- 会话创建数 / 天
- 平均对话轮次
- 场景识别准确率
- 任务提交成功率
- Card 完成率

### 11.2 技术指标
- API 响应时间（P50, P95, P99）
- Tool 调用延迟
- 错误率
- 并发会话数
- LLM Token 消耗

### 11.3 成本指标
- LLM API 调用费用
- 每个任务配置的平均 Token 消耗
- 基础设施成本（CPU、内存、存储）
