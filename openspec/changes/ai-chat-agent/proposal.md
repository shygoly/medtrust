# AI Chat Agent for MedTrust - OpenSpec Change Proposal

## 概述

为 MedTrust 可信空间添加对话式 AI Agent，用于引导用户配置和提交计算任务，替代为每个场景单独开发 UI 表单的模式。

## 动机

### 问题
1. **场景爆炸**：每个计算场景（L4 FL、单臂对比、负荷预测、窃电检测等）都需要单独的 UI 表单
2. **维护成本高**：新增场景需要前后端联动开发
3. **用户门槛高**：需要理解技术参数才能填写表单
4. **缺乏引导**：用户不知道哪些场景适合自己的需求

### 解决方案
采用 **Pi Agent 轻量架构**，通过对话式交互：
- 理解用户需求，推荐合适场景
- 引导用户逐步配置参数
- 用 Card Message 收集结构化输入
- 统一提交到对应的 MDOP 模板 API

## 设计

### 架构原则（Pi Agent）
1. **轻量**：不引入重型框架，核心是 prompt + tools + card renderer
2. **无状态**：对话历史即状态，不需要复杂的 FSM
3. **工具驱动**：Agent 通过调用工具（API）完成任务
4. **渐进式**：从单一场景开始，逐步扩展

### Monorepo 目录结构

```
apps/
├── chat-agent/                 # AI Chat Agent 应用
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts           # 入口
│   │   ├── agent/
│   │   │   ├── core.ts        # Pi Agent 核心（prompt + tool loop）
│   │   │   ├── prompts/       # 系统 prompts
│   │   │   │   ├── system.md
│   │   │   │   └── scenarios/ # 各场景的 prompt 片段
│   │   │   └── tools/         # Agent 可用的工具
│   │   │       ├── mdop.ts    # MDOP 任务提交工具
│   │   │       ├── space.ts   # 空间信息查询
│   │   │       └── templates.ts # 模板信息
│   │   ├── api/
│   │   │   ├── server.ts      # HTTP server（NestJS 或 Fastify）
│   │   │   └── routes/
│   │   │       ├── chat.ts    # POST /chat
│   │   │       └── health.ts
│   │   └── cards/             # Card Message 定义
│   │       ├── types.ts
│   │       └── templates/
│   │           ├── external-control.ts  # 单臂对比卡片
│   │           ├── load-forecast.ts     # 负荷预测卡片
│   │           └── fl-prediction.ts     # L4 FL 卡片
│   └── test/
│       ├── agent.spec.ts
│       └── e2e/
│           └── chat-flow.spec.ts  # Playwright E2E

packages/
├── chat-cards/                 # Card Message 组件库（可被 web 复用）
│   ├── package.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── types.ts           # Card 类型定义
│   │   ├── renderer.tsx       # React Card 渲染器
│   │   └── cards/
│   │       ├── FormCard.tsx   # 表单卡片
│   │       ├── StatusCard.tsx # 状态卡片
│   │       └── ResultCard.tsx # 结果卡片
│   └── test/
└── pi-agent/                   # Pi Agent 核心库（可复用）
    ├── package.json
    ├── src/
    │   ├── index.ts
    │   ├── agent.ts           # Agent 核心逻辑
    │   ├── tool.ts            # Tool 抽象
    │   ├── message.ts         # Message 类型
    │   └── llm/
    │       ├── client.ts      # LLM 客户端（支持 Anthropic/OpenAI）
    │       └── types.ts
    └── test/
```

### 核心组件

#### 1. Pi Agent Core (`packages/pi-agent`)

```typescript
// packages/pi-agent/src/agent.ts
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: unknown) => Promise<unknown>;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string | CardMessage;
  toolCalls?: ToolCall[];
}

export class PiAgent {
  constructor(
    private systemPrompt: string,
    private tools: Tool[],
    private llm: LLMClient
  ) {}

  async chat(userMessage: string, history: Message[]): Promise<Message> {
    const messages = [
      { role: 'system', content: this.systemPrompt },
      ...history,
      { role: 'user', content: userMessage }
    ];

    let response = await this.llm.complete(messages, this.tools);

    // Tool call loop
    while (response.toolCalls?.length > 0) {
      const toolResults = await Promise.all(
        response.toolCalls.map(call => this.executeTool(call))
      );

      messages.push(...toolResults);
      response = await this.llm.complete(messages, this.tools);
    }

    return response;
  }

  private async executeTool(call: ToolCall): Promise<Message> {
    const tool = this.tools.find(t => t.name === call.name);
    const result = await tool.execute(call.parameters);
    return { role: 'tool', content: JSON.stringify(result) };
  }
}
```

#### 2. Chat Agent Application (`apps/chat-agent`)

```typescript
// apps/chat-agent/src/agent/core.ts
import { PiAgent } from '@medtrust/pi-agent';
import { mdopTools } from './tools/mdop';
import { spaceTools } from './tools/space';
import { systemPrompt } from './prompts/system';

export function createMedTrustAgent(): PiAgent {
  return new PiAgent(
    systemPrompt,
    [...mdopTools, ...spaceTools],
    new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY })
  );
}

// apps/chat-agent/src/agent/tools/mdop.ts
export const mdopTools: Tool[] = [
  {
    name: 'submit_external_control',
    description: '提交单臂试验外部对照任务',
    parameters: {
      type: 'object',
      properties: {
        trial: { type: 'object', description: '试验方信息' },
        controls: { type: 'object', description: '对照方信息' },
        strataKeys: { type: 'array', description: '分层键' },
        // ...
      }
    },
    execute: async (params) => {
      const response = await fetch('http://localhost:3000/api/v1/mdop/jobs/external-control', {
        method: 'POST',
        body: JSON.stringify(params)
      });
      return response.json();
    }
  },
  {
    name: 'submit_load_forecast',
    description: '提交负荷预测任务',
    parameters: { /* ... */ },
    execute: async (params) => { /* ... */ }
  }
];
```

#### 3. Card Message (`packages/chat-cards`)

```typescript
// packages/chat-cards/src/types.ts
export interface CardMessage {
  type: 'form' | 'status' | 'result';
  title: string;
  fields?: FormField[];
  data?: Record<string, unknown>;
}

export interface FormField {
  name: string;
  label: string;
  type: 'text' | 'select' | 'number' | 'date';
  options?: Array<{ label: string; value: string }>;
  required?: boolean;
  defaultValue?: unknown;
}

// packages/chat-cards/src/cards/FormCard.tsx
export function FormCard({ card, onSubmit }: FormCardProps) {
  const [values, setValues] = useState({});

  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form>
          {card.fields?.map(field => (
            <FormField key={field.name} {...field} />
          ))}
        </Form>
      </CardContent>
      <CardFooter>
        <Button onClick={() => onSubmit(values)}>提交</Button>
      </CardFooter>
    </Card>
  );
}
```

#### 4. System Prompt

```markdown
<!-- apps/chat-agent/src/agent/prompts/system.md -->
# MedTrust 可信空间 AI Assistant

你是 MedTrust 可信空间的 AI 助手，帮助用户配置和提交多方安全计算任务。

## 你的职责
1. 理解用户的计算需求
2. 推荐合适的计算场景（单臂对比、L4 FL、负荷预测等）
3. 引导用户逐步配置参数
4. 通过 Card Message 收集结构化输入
5. 调用对应的 API 提交任务

## 可用场景
- **单臂试验外部对照** (external-control)：试验组 + 对照组分层匹配
- **L4 联邦学习** (fl-prediction)：多方协同训练预测模型
- **负荷预测** (load-forecast)：电力负荷预测（时序分析）
- **需求响应** (demand-response)：削峰填谷优化
- **窃电检测** (theft-detection)：异常用电检测

## 工作流程
1. 询问用户需求（领域、数据、目标）
2. 推荐场景并解释原理
3. 用 Card Message 收集参数：
   - 参与方选择
   - 数据产品配置
   - 场景特定参数
4. 调用工具提交任务
5. 返回任务状态和追踪信息

## Card Message 示例
当需要收集参数时，返回 Card：
```json
{
  "type": "form",
  "title": "外部对照配置",
  "fields": [
    {"name": "trial", "label": "试验方", "type": "select"},
    {"name": "controls", "label": "对照方", "type": "select"},
    {"name": "strataKeys", "label": "分层键", "type": "text"}
  ]
}
```

## 注意事项
- 确保试验方和对照方不同
- 分层键格式：["<40|M", "40+|F"]
- 参数验证在提交前完成
```

### API 设计

```typescript
// apps/chat-agent/src/api/routes/chat.ts
router.post('/chat', async (req, res) => {
  const { message, sessionId, history } = req.body;

  const agent = createMedTrustAgent();
  const response = await agent.chat(message, history);

  res.json({
    message: response.content,
    toolCalls: response.toolCalls,
    sessionId
  });
});

// POST /chat
// Request:
{
  "message": "我想做一个单臂试验的外部对照",
  "sessionId": "session-123",
  "history": []
}

// Response:
{
  "message": {
    "type": "form",
    "title": "外部对照配置",
    "fields": [...]
  },
  "sessionId": "session-123"
}
```

### 前端集成

```tsx
// apps/web/src/components/chat/ChatAgent.tsx
export function ChatAgent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const handleSend = async () => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: input,
        history: messages
      })
    });

    const { message } = await response.json();
    setMessages([...messages, { role: 'user', content: input }, message]);
  };

  return (
    <div className="chat-container">
      <MessageList messages={messages} />
      {messages.at(-1)?.content?.type === 'form' && (
        <FormCard card={messages.at(-1).content} onSubmit={handleCardSubmit} />
      )}
      <ChatInput value={input} onChange={setInput} onSend={handleSend} />
    </div>
  );
}
```

## 实施计划

### Phase 1: 基础设施（1-2 天）
- [x] 设计 monorepo 结构
- [ ] 创建 `packages/pi-agent` 核心库
- [ ] 创建 `packages/chat-cards` 组件库
- [ ] 创建 `apps/chat-agent` 应用骨架

### Phase 2: 单场景验证（2-3 天）
- [ ] 实现单臂对照场景的完整流程
- [ ] System prompt + Tools + Card Message
- [ ] 前端集成（简单 Chat UI）
- [ ] E2E 测试（Playwright）

### Phase 3: 多场景扩展（3-5 天）
- [ ] 添加 L4 FL 场景
- [ ] 添加电力包场景（负荷预测、需求响应）
- [ ] 场景推荐逻辑
- [ ] 会话持久化

### Phase 4: 优化与部署（2-3 天）
- [ ] 流式响应（SSE）
- [ ] 错误处理和重试
- [ ] 监控和日志
- [ ] 部署到生产环境

## 对比

| 维度 | OpenClaw（重型） | Pi Agent（轻量） |
|------|------------------|------------------|
| 核心概念 | Plugin + Contract + Workspace | Prompt + Tools + Cards |
| 配置 | JSON Schema + Activation | Markdown Prompt |
| 状态管理 | Workspace + Session Store | Message History |
| 工具定义 | Contract + Backend Forwarding | Simple Tool Interface |
| 复杂度 | 高（需要插件系统、配置管理） | 低（只需 Agent + Tools） |
| 适用场景 | 多租户、插件市场 | 单一应用、快速迭代 |

## 配置示例

```json
// apps/chat-agent/.env
ANTHROPIC_API_KEY=sk-ant-xxxxx
MEDTRUST_API_URL=http://localhost:3000
PORT=4000

// pnpm-workspace.yaml (已有，需添加)
packages:
  - 'apps/*'
  - 'packages/*'
  - 'industries/*'
  - 'apps/chat-agent'
  - 'packages/pi-agent'
  - 'packages/chat-cards'
```

## 测试策略

### 单元测试
```typescript
describe('PiAgent', () => {
  it('should execute tool and return result', async () => {
    const agent = new PiAgent(systemPrompt, [mockTool], mockLLM);
    const response = await agent.chat('submit task', []);
    expect(response.content).toContain('Task submitted');
  });
});
```

### E2E 测试
```typescript
describe('External Control Chat Flow', () => {
  it('should guide user through external control configuration', async () => {
    await page.goto('http://localhost:5020/chat');
    await page.type('#chat-input', '我想做单臂对照');
    await page.click('[data-testid="send"]');

    await page.waitForSelector('[data-card-type="form"]');
    expect(await page.textContent('h3')).toBe('外部对照配置');

    // 填写表单
    await page.selectOption('[name="trial"]', 'p-sponsor');
    await page.selectOption('[name="controls"]', 'p-hosp-a');
    await page.fill('[name="strataKeys"]', '<40|M, 40+|F');
    await page.click('[data-testid="submit-card"]');

    await page.waitForText('任务已提交');
  });
});
```

## 后续扩展

1. **多模态**：支持上传数据集描述文件
2. **协同**：多用户会话（团队协作配置任务）
3. **知识库**：集成法规、最佳实践文档
4. **智能推荐**：基于历史任务推荐场景和参数

## 参考

- Pi Agent 理念：轻量、无状态、工具驱动
- Anthropic Claude：支持 function calling
- React Server Components：用于 Card Message 渲染
- NestJS：Chat Agent 后端框架
