# AI Chat Agent - Design Document

## 1. 架构概览

### 1.1 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Frontend                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  apps/web/src/components/chat/                       │  │
│  │  ├── ChatAgent.tsx        (主界面)                   │  │
│  │  ├── MessageList.tsx      (消息列表)                 │  │
│  │  ├── ChatInput.tsx        (输入框)                   │  │
│  │  └── CardRenderer.tsx     (Card 渲染器)              │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP / WebSocket
┌───────────────────────────▼─────────────────────────────────┐
│                    Chat Agent Service                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  apps/chat-agent/src/                                │  │
│  │  ├── api/                 (HTTP API)                 │  │
│  │  │   ├── chat.controller.ts                          │  │
│  │  │   └── session.controller.ts                       │  │
│  │  ├── agent/               (Pi Agent)                 │  │
│  │  │   ├── core.ts          (Agent 实例)               │  │
│  │  │   ├── prompts/         (System prompts)           │  │
│  │  │   └── tools/           (Tool 实现)                │  │
│  │  └── cards/               (Card 模板)                │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────┬───────────────────────┬─────────────────────┘
                │                       │
        ┌───────▼──────┐        ┌──────▼──────┐
        │  PostgreSQL  │        │   Redis     │
        │  (会话存储)  │        │  (缓存)     │
        └──────────────┘        └─────────────┘
                │
        ┌───────▼──────────────────────────────┐
        │     MedTrust Core Services           │
        │  ├── API (MDOP Jobs)                 │
        │  ├── Space Management                │
        │  └── User Authentication             │
        └──────────────────────────────────────┘
```

### 1.2 核心组件

#### 1.2.1 Pi Agent Core (`packages/pi-agent`)

**职责**：提供轻量级的 Agent 运行时

**设计原则**：
- **无状态**：不持有会话状态，状态由调用方管理
- **工具驱动**：通过 Tool 接口扩展能力
- **LLM 无关**：支持 Anthropic、OpenAI 等多种 LLM

**核心类**：

```typescript
// packages/pi-agent/src/agent.ts
export class PiAgent {
  constructor(
    private config: AgentConfig,
    private tools: Tool[],
    private llm: LLMClient
  ) {}

  /**
   * 处理单轮对话
   * @param userMessage 用户消息
   * @param history 历史消息
   * @returns Agent 响应
   */
  async chat(
    userMessage: string,
    history: Message[]
  ): Promise<AgentResponse> {
    // 1. 构造 messages
    const messages = this.buildMessages(userMessage, history);

    // 2. 调用 LLM
    let response = await this.llm.complete(messages, this.tools);

    // 3. Tool call loop
    while (response.toolCalls?.length > 0) {
      const toolResults = await this.executeTools(response.toolCalls);
      messages.push(...toolResults);
      response = await this.llm.complete(messages, this.tools);
    }

    return response;
  }

  private buildMessages(
    userMessage: string,
    history: Message[]
  ): LLMMessage[] {
    return [
      { role: 'system', content: this.config.systemPrompt },
      ...history.map(m => this.toLLMMessage(m)),
      { role: 'user', content: userMessage }
    ];
  }

  private async executeTools(
    toolCalls: ToolCall[]
  ): Promise<Message[]> {
    return Promise.all(
      toolCalls.map(async call => {
        const tool = this.tools.find(t => t.name === call.name);
        if (!tool) {
          return {
            role: 'tool',
            name: call.name,
            content: JSON.stringify({
              error: `Tool ${call.name} not found`
            })
          };
        }

        try {
          const result = await tool.execute(
            call.parameters,
            this.buildContext()
          );
          return {
            role: 'tool',
            name: call.name,
            content: JSON.stringify(result)
          };
        } catch (error) {
          return {
            role: 'tool',
            name: call.name,
            content: JSON.stringify({
              error: error.message
            })
          };
        }
      })
    );
  }
}
```

**Tool 接口**：

```typescript
// packages/pi-agent/src/tool.ts
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ParameterSchema>;
  required?: string[];
}

export interface ParameterSchema {
  type: string;
  description: string;
  enum?: string[];
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
}

export interface ToolContext {
  userId: string;
  spaceId: string;
  sessionId: string;
  apiClient: APIClient;  // MedTrust API 客户端
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

**LLM Client 接口**：

```typescript
// packages/pi-agent/src/llm/client.ts
export interface LLMClient {
  complete(
    messages: LLMMessage[],
    tools: Tool[]
  ): Promise<LLMResponse>;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;  // tool name for tool messages
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}
```

**Anthropic 实现**：

```typescript
// packages/pi-agent/src/llm/anthropic.ts
export class AnthropicClient implements LLMClient {
  constructor(private config: AnthropicConfig) {}

  async complete(
    messages: LLMMessage[],
    tools: Tool[]
  ): Promise<LLMResponse> {
    const response = await this.anthropic.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: this.extractSystemPrompt(messages),
      messages: this.formatMessages(messages),
      tools: this.formatTools(tools)
    });

    return {
      content: this.extractContent(response),
      toolCalls: this.extractToolCalls(response),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      }
    };
  }

  private formatTools(tools: Tool[]): AnthropicTool[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
  }
}
```

#### 1.2.2 Chat Agent Application (`apps/chat-agent`)

**职责**：提供 HTTP API 和 Agent 实例管理

**目录结构**：

```
apps/chat-agent/
├── src/
│   ├── main.ts                    # 应用入口
│   ├── app.module.ts              # NestJS 根模块
│   ├── config/
│   │   ├── agent.config.ts        # Agent 配置
│   │   └── llm.config.ts          # LLM 配置
│   ├── api/
│   │   ├── chat/
│   │   │   ├── chat.controller.ts
│   │   │   ├── chat.service.ts
│   │   │   └── dto/
│   │   │       ├── chat-request.dto.ts
│   │   │       └── chat-response.dto.ts
│   │   └── session/
│   │       ├── session.controller.ts
│   │       └── session.service.ts
│   ├── agent/
│   │   ├── core.ts                # PiAgent 实例工厂
│   │   ├── prompts/
│   │   │   ├── system.md          # 主系统 prompt
│   │   │   └── scenarios/
│   │   │       ├── external-control.md
│   │   │       ├── load-forecast.md
│   │   │       └── fl-prediction.md
│   │   └── tools/
│   │       ├── index.ts
│   │       ├── mdop.tools.ts      # MDOP 任务提交
│   │       ├── space.tools.ts     # 空间信息查询
│   │       └── template.tools.ts  # 模板信息查询
│   ├── cards/
│   │   ├── card.service.ts        # Card 生成服务
│   │   └── templates/
│   │       ├── external-control.ts
│   │       ├── load-forecast.ts
│   │       └── fl-prediction.ts
│   ├── session/
│   │   ├── session.repository.ts  # 会话持久化
│   │   └── entities/
│   │       ├── session.entity.ts
│   │       └── message.entity.ts
│   └── common/
│       ├── filters/
│       │   └── http-exception.filter.ts
│       ├── interceptors/
│       │   └── logging.interceptor.ts
│       └── guards/
│           └── auth.guard.ts
└── test/
    ├── e2e/
    │   ├── chat.e2e.spec.ts
    │   └── playwright/
    │       └── chat-flow.spec.ts
    └── integration/
        └── agent-tools.spec.ts
```

**Chat Controller**：

```typescript
// apps/chat-agent/src/api/chat/chat.controller.ts
@Controller('api/v1/chat')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(
    private chatService: ChatService,
    private sessionService: SessionService
  ) {}

  @Post()
  async chat(
    @Body() dto: ChatRequestDto,
    @CurrentUser() user: User
  ): Promise<ChatResponseDto> {
    // 1. 获取或创建会话
    const session = await this.sessionService.getOrCreate(
      dto.sessionId,
      user.id,
      dto.spaceId
    );

    // 2. 保存用户消息
    await this.sessionService.addMessage(session.id, {
      role: 'user',
      content: dto.message
    });

    // 3. 调用 Agent
    const history = await this.sessionService.getMessages(session.id);
    const response = await this.chatService.chat(
      dto.message,
      history,
      {
        userId: user.id,
        spaceId: dto.spaceId,
        sessionId: session.id
      }
    );

    // 4. 保存 Agent 响应
    await this.sessionService.addMessage(session.id, {
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls
    });

    return {
      sessionId: session.id,
      message: response.content,
      suggestions: this.generateSuggestions(response)
    };
  }

  @Get('sessions')
  async listSessions(
    @CurrentUser() user: User,
    @Query('spaceId') spaceId: string
  ): Promise<SessionListDto> {
    return this.sessionService.list(user.id, spaceId);
  }

  @Get('sessions/:id')
  async getSession(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<SessionDetailDto> {
    return this.sessionService.getDetail(id, user.id);
  }

  @Delete('sessions/:id')
  async deleteSession(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<void> {
    await this.sessionService.delete(id, user.id);
  }
}
```

**Chat Service**：

```typescript
// apps/chat-agent/src/api/chat/chat.service.ts
@Injectable()
export class ChatService {
  private agent: PiAgent;

  constructor(
    @Inject('AGENT_CONFIG') private config: AgentConfig,
    @Inject('LLM_CLIENT') private llm: LLMClient,
    private toolRegistry: ToolRegistry
  ) {
    this.agent = new PiAgent(
      config,
      toolRegistry.getTools(),
      llm
    );
  }

  async chat(
    userMessage: string,
    history: Message[],
    context: ChatContext
  ): Promise<AgentResponse> {
    try {
      // 注入上下文到 tools
      this.toolRegistry.setContext(context);

      // 调用 Agent
      const response = await this.agent.chat(userMessage, history);

      // 记录指标
      this.metricsService.recordChat({
        sessionId: context.sessionId,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
        toolCalls: response.toolCalls?.length || 0,
        duration: Date.now() - startTime
      });

      return response;
    } catch (error) {
      this.logger.error('Chat failed', error, context);
      throw new ChatException('对话失败，请稍后重试');
    }
  }
}
```

**Tool Registry**：

```typescript
// apps/chat-agent/src/agent/tools/index.ts
@Injectable()
export class ToolRegistry {
  private tools: Tool[] = [];
  private context: ToolContext;

  constructor(
    private mdopTools: MdopTools,
    private spaceTools: SpaceTools,
    private templateTools: TemplateTools
  ) {
    this.registerTools();
  }

  private registerTools() {
    this.tools = [
      ...this.mdopTools.getTools(),
      ...this.spaceTools.getTools(),
      ...this.templateTools.getTools()
    ];
  }

  setContext(context: ToolContext) {
    this.context = context;
    // 更新所有 tools 的 context
    for (const tool of this.tools) {
      if (tool.setContext) {
        tool.setContext(context);
      }
    }
  }

  getTools(): Tool[] {
    return this.tools;
  }
}
```

**MDOP Tools**：

```typescript
// apps/chat-agent/src/agent/tools/mdop.tools.ts
@Injectable()
export class MdopTools {
  constructor(
    private httpService: HttpService,
    @Inject('MEDTRUST_API_URL') private apiUrl: string
  ) {}

  getTools(): Tool[] {
    return [
      {
        name: 'submit_external_control',
        description: '提交单臂试验外部对照任务',
        parameters: {
          type: 'object',
          properties: {
            trial: {
              type: 'object',
              description: '试验方信息',
              properties: {
                participantId: { type: 'string' },
                dataProductId: { type: 'string' }
              },
              required: ['participantId', 'dataProductId']
            },
            controls: {
              type: 'object',
              description: '对照方信息',
              properties: {
                participantId: { type: 'string' },
                dataProductId: { type: 'string' }
              },
              required: ['participantId', 'dataProductId']
            },
            strataKeys: {
              type: 'array',
              description: '分层键（如 ["<40|M", "40+|F"]）',
              items: { type: 'string' }
            },
            caliperDays: {
              type: 'number',
              description: '卡尺天数',
              minimum: 1,
              maximum: 365,
              default: 30
            },
            ratioK: {
              type: 'number',
              description: '匹配比例（对照:试验 = K:1）',
              minimum: 1,
              maximum: 10,
              default: 2
            }
          },
          required: ['trial', 'controls', 'strataKeys']
        },
        execute: async (params, context) => {
          return this.submitExternalControl(params, context);
        }
      },
      {
        name: 'submit_load_forecast',
        description: '提交电力负荷预测任务',
        parameters: { /* ... */ },
        execute: async (params, context) => {
          return this.submitLoadForecast(params, context);
        }
      }
      // ... 其他场景
    ];
  }

  private async submitExternalControl(
    params: ExternalControlParams,
    context: ToolContext
  ): Promise<ToolResult> {
    try {
      const response = await this.httpService.axiosRef.post(
        `${this.apiUrl}/api/v1/mdop/jobs/external-control`,
        {
          purpose: '外部对照 RWS',
          applicant: {
            org: context.userId,
            project: context.spaceId
          },
          ...params
        },
        {
          headers: {
            Authorization: `Bearer ${context.accessToken}`
          }
        }
      );

      return {
        success: true,
        data: {
          jobId: response.data.jobId,
          status: response.data.status,
          stages: response.data.stages
        }
      };
    } catch (error) {
      this.logger.error('Submit external control failed', error);
      return {
        success: false,
        error: error.response?.data?.message || '任务提交失败'
      };
    }
  }
}
```

#### 1.2.3 Card Components (`packages/chat-cards`)

**职责**：提供可复用的 Card 渲染组件

**目录结构**：

```
packages/chat-cards/
├── src/
│   ├── index.ts
│   ├── types.ts               # Card 类型定义
│   ├── renderer.tsx           # Card 渲染器
│   ├── cards/
│   │   ├── FormCard.tsx       # 表单卡片
│   │   ├── StatusCard.tsx     # 状态卡片
│   │   ├── ResultCard.tsx     # 结果卡片
│   │   └── ConfirmCard.tsx    # 确认卡片
│   ├── fields/                # 表单字段组件
│   │   ├── TextField.tsx
│   │   ├── SelectField.tsx
│   │   ├── NumberField.tsx
│   │   └── DateField.tsx
│   └── utils/
│       ├── validation.ts      # 字段验证
│       └── formatting.ts      # 格式化工具
└── test/
    └── cards.spec.tsx
```

**Card Renderer**：

```tsx
// packages/chat-cards/src/renderer.tsx
export function CardRenderer({ card, onSubmit }: CardRendererProps) {
  switch (card.type) {
    case 'form':
      return <FormCard card={card} onSubmit={onSubmit} />;
    case 'status':
      return <StatusCard card={card} />;
    case 'result':
      return <ResultCard card={card} />;
    case 'confirm':
      return <ConfirmCard card={card} onSubmit={onSubmit} />;
    default:
      return null;
  }
}

// packages/chat-cards/src/cards/FormCard.tsx
export function FormCard({ card, onSubmit }: FormCardProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleFieldChange = (name: string, value: unknown) => {
    setValues(prev => ({ ...prev, [name]: value }));
    // 清除该字段的错误
    if (errors[name]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleSubmit = () => {
    // 验证所有字段
    const validationErrors = validateFields(card.fields, values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    onSubmit(values);
  };

  return (
    <Card className="chat-card">
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
        {card.description && (
          <CardDescription>{card.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <Form>
          {card.fields?.map(field => (
            <FormItem key={field.name}>
              <FormLabel>
                {field.label}
                {field.required && <span className="text-red-500">*</span>}
              </FormLabel>
              <FieldRenderer
                field={field}
                value={values[field.name]}
                error={errors[field.name]}
                onChange={value => handleFieldChange(field.name, value)}
              />
              {field.help && (
                <FormDescription>{field.help}</FormDescription>
              )}
              {errors[field.name] && (
                <FormMessage>{errors[field.name]}</FormMessage>
              )}
            </FormItem>
          ))}
        </Form>
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        {card.actions?.map(action => (
          <Button
            key={action.label}
            variant={action.variant || 'default'}
            onClick={action.type === 'submit' ? handleSubmit : undefined}
          >
            {action.label}
          </Button>
        ))}
      </CardFooter>
    </Card>
  );
}

// packages/chat-cards/src/fields/SelectField.tsx
export function SelectField({ field, value, onChange }: FieldProps) {
  return (
    <Select
      value={value as string}
      onValueChange={onChange}
    >
      <SelectTrigger>
        <SelectValue placeholder={field.placeholder} />
      </SelectTrigger>
      <SelectContent>
        {field.options?.map(option => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

### 1.3 数据流

#### 1.3.1 典型对话流程

```
用户: "我想做单臂对照"
  ↓
┌─────────────────────────────────────┐
│ 1. Frontend: POST /api/v1/chat      │
│    { message, sessionId, spaceId }  │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 2. ChatController                   │
│    - 验证用户权限                   │
│    - 获取/创建会话                  │
│    - 保存用户消息                   │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 3. ChatService.chat()               │
│    - 加载历史消息                   │
│    - 构造 context                   │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 4. PiAgent.chat()                   │
│    - 构造 messages (system + history)│
│    - 调用 LLM                       │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 5. LLM 识别场景，返回 Card         │
│    {                                │
│      type: "form",                  │
│      title: "外部对照配置",         │
│      fields: [...]                  │
│    }                                │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 6. Frontend: 渲染 FormCard         │
│    用户填写表单                     │
└────────────┬────────────────────────┘
             ↓
用户: 点击"提交" → 表单数据
  ↓
┌─────────────────────────────────────┐
│ 7. Frontend: 将表单数据作为消息    │
│    POST /api/v1/chat                │
│    { message: JSON.stringify(data) }│
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 8. PiAgent: LLM 识别为任务提交     │
│    决定调用 submit_external_control │
│    tool                             │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 9. Tool.execute()                   │
│    POST /api/v1/mdop/jobs/external- │
│    control                          │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 10. 返回任务结果                    │
│     { jobId, status, stages }       │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 11. Agent 生成响应                  │
│     "任务已提交，任务ID: job-12345" │
│     + StatusCard                    │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 12. Frontend: 显示结果              │
│     + 渲染 StatusCard               │
└─────────────────────────────────────┘
```

## 2. 关键设计决策

### 2.1 为什么选择 Pi Agent 而非 OpenClaw？

| 考量维度 | Pi Agent | OpenClaw |
|---------|----------|----------|
| **复杂度** | ✅ 低（~500 LoC 核心） | ❌ 高（需要插件系统、配置管理） |
| **启动速度** | ✅ 快（无需加载插件） | ❌ 慢（需要扫描、加载插件） |
| **可调试性** | ✅ 简单（直接追踪调用栈） | ❌ 复杂（多层抽象） |
| **适用场景** | ✅ 单一应用 | ❌ 多租户插件市场 |
| **学习曲线** | ✅ 平缓 | ❌ 陡峭 |

### 2.2 为什么用 Card Message 而非纯文本？

**问题**：纯文本对话难以收集结构化参数

**Card Message 优势**：
1. **类型安全**：字段有明确的类型和验证规则
2. **用户体验**：下拉选择比手动输入更友好
3. **减少错误**：前端验证减少无效提交
4. **可复用**：Card 模板可跨场景复用

### 2.3 为什么 Tool 驱动而非 FSM？

**FSM（有限状态机）问题**：
- 状态爆炸：场景 × 步骤 = 大量状态
- 难以扩展：新增场景需要修改状态机
- 脆弱：用户可能跳步骤或回退

**Tool 驱动优势**：
- LLM 根据上下文动态决定调用哪个 Tool
- 无需预定义所有状态转移
- 用户可以自由对话（「等等，我想改一下参与方」）

### 2.4 Session 存储设计

**选择 PostgreSQL + Redis**：
- PostgreSQL：持久化会话和消息（可追溯、可查询）
- Redis：缓存活跃会话（减少 DB 查询）

**会话生命周期**：
```
创建 → 活跃 → 过期 → 归档
        ↓        ↓
      Redis   PostgreSQL
```

**清理策略**：
- 24 小时无活动自动过期
- 过期会话从 Redis 清除
- PostgreSQL 保留 90 天后归档

## 3. 安全设计

### 3.1 认证与授权

**认证**：
- 复用 MedTrust 现有的 JWT 认证
- Chat API 需要 `Authorization: Bearer <token>`

**授权**：
- 用户只能访问自己的会话
- Tool 执行时携带用户 token
- MDOP API 会验证用户对空间/数据的权限

### 3.2 输入验证

**前端验证**：
- Card 字段类型和范围检查
- 必填字段验证

**后端验证**：
- DTO 验证（class-validator）
- 参数业务规则验证（试验方 ≠ 对照方）

**LLM 输出验证**：
- Tool call 参数 schema 验证
- Card message 结构验证

### 3.3 敏感信息保护

**不记录的内容**：
- 数据产品内容（只记录 ID）
- API Token（只在运行时内存中）
- PHI/PII（只记录加密后的引用）

**日志脱敏**：
```typescript
logger.info('Tool called', {
  toolName: call.name,
  // 不记录完整 parameters
  parameterKeys: Object.keys(call.parameters)
});
```

## 4. 性能优化

### 4.1 响应时间优化

**目标**：P95 < 2s

**策略**：
1. **并行 Tool 调用**：多个独立 tool 可并行执行
2. **Redis 缓存**：
   - 空间成员列表（TTL 5 分钟）
   - 模板信息（TTL 1 小时）
3. **流式响应**（Phase 2）：
   - SSE 实时推送 LLM 输出
   - 用户提前看到部分响应

### 4.2 LLM Token 优化

**问题**：历史消息越多，token 消耗越大

**策略**：
1. **滑动窗口**：只保留最近 10 轮对话
2. **消息压缩**：
   - Tool 调用结果只保留关键字段
   - 用户消息去除冗余
3. **System prompt 优化**：
   - 核心指令 < 500 tokens
   - 场景描述按需加载

### 4.3 并发控制

**问题**：同一用户多个并发请求

**策略**：
- 每个会话一个锁（Redis）
- 并发请求排队处理
- 超时时间 30s

## 5. 监控与可观测性

### 5.1 日志

**结构化日志**：
```json
{
  "timestamp": "2026-10-16T10:00:00Z",
  "level": "info",
  "event": "chat_completed",
  "sessionId": "session-123",
  "userId": "user-456",
  "spaceId": "space-789",
  "duration": 1234,
  "inputTokens": 500,
  "outputTokens": 300,
  "toolCalls": ["submit_external_control"]
}
```

### 5.2 指标

**关键指标**：
- `chat_requests_total`：总请求数
- `chat_duration_seconds`：响应时间分布
- `tool_calls_total`：Tool 调用次数（按 tool name）
- `tool_errors_total`：Tool 失败次数
- `llm_tokens_total`：Token 消耗（input/output）
- `active_sessions_count`：活跃会话数

### 5.3 追踪

**分布式追踪**（OpenTelemetry）：
```
Span: /api/v1/chat
  ├─ Span: ChatService.chat
  │   ├─ Span: PiAgent.chat
  │   │   ├─ Span: LLM.complete
  │   │   └─ Span: Tool.execute (submit_external_control)
  │   │       └─ Span: HTTP POST /mdop/jobs/external-control
  │   └─ Span: SessionRepository.save
  └─ Span: Redis.set
```

## 6. 测试策略

### 6.1 单元测试

**核心组件**：
- `PiAgent`: 消息构造、tool loop
- `Tool`: execute 逻辑
- `CardRenderer`: 渲染和验证
- `FieldValidator`: 字段验证规则

### 6.2 集成测试

**场景**：
- Agent + Tools 集成
- Session 持久化
- API 端点完整流程

### 6.3 E2E 测试（Playwright）

**测试用例**：
```typescript
test('外部对照完整流程', async ({ page }) => {
  // 1. 登录
  await page.goto('/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');

  // 2. 打开 Chat
  await page.goto('/chat');

  // 3. 输入需求
  await page.fill('#chat-input', '我想做单臂对照');
  await page.press('#chat-input', 'Enter');

  // 4. 等待 Card 出现
  await page.waitForSelector('[data-card-type="form"]');
  const title = await page.textContent('h3');
  expect(title).toBe('外部对照配置');

  // 5. 填写表单
  await page.selectOption('[name="trial"]', 'p-sponsor');
  await page.selectOption('[name="controls"]', 'p-hosp-a');
  await page.fill('[name="strataKeys"]', '<40|M, 40+|F');
  await page.fill('[name="caliperDays"]', '30');
  await page.fill('[name="ratioK"]', '2');

  // 6. 提交
  await page.click('[data-testid="submit-card"]');

  // 7. 验证响应
  await page.waitForText('任务已提交');
  const jobId = await page.textContent('[data-testid="job-id"]');
  expect(jobId).toMatch(/^job-\d+$/);
});
```

## 7. 部署架构

### 7.1 Docker Compose（开发环境）

```yaml
version: '3.8'

services:
  chat-agent:
    build: ./apps/chat-agent
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/medtrust
      - REDIS_URL=redis://redis:6379
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - MEDTRUST_API_URL=http://api:3000
    depends_on:
      - postgres
      - redis
      - api

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: medtrust
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

  api:
    build: ./apps/api
    ports:
      - "3000:3000"

volumes:
  postgres-data:
  redis-data:
```

### 7.2 Kubernetes（生产环境）

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
    metadata:
      labels:
        app: chat-agent
    spec:
      containers:
      - name: chat-agent
        image: medtrust/chat-agent:latest
        ports:
        - containerPort: 4000
        env:
        - name: NODE_ENV
          value: production
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: chat-agent-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: chat-agent-secrets
              key: redis-url
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: chat-agent-secrets
              key: anthropic-api-key
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 4000
          initialDelaySeconds: 10
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: chat-agent
spec:
  selector:
    app: chat-agent
  ports:
  - port: 4000
    targetPort: 4000
  type: ClusterIP

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: chat-agent
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
  - hosts:
    - chat.medtrust.ai
    secretName: chat-agent-tls
  rules:
  - host: chat.medtrust.ai
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: chat-agent
            port:
              number: 4000
```

## 8. 扩展性设计

### 8.1 新增场景

**步骤**：
1. 定义 Tool：
   ```typescript
   // apps/chat-agent/src/agent/tools/new-scenario.tool.ts
   export const newScenarioTool: Tool = {
     name: 'submit_new_scenario',
     description: '...',
     parameters: { /* ... */ },
     execute: async (params, context) => { /* ... */ }
   };
   ```

2. 添加 Prompt 片段：
   ```markdown
   <!-- apps/chat-agent/src/agent/prompts/scenarios/new-scenario.md -->
   ## 新场景
   - 适用条件：...
   - 参数说明：...
   - 使用示例：...
   ```

3. 定义 Card 模板：
   ```typescript
   // apps/chat-agent/src/cards/templates/new-scenario.ts
   export const newScenarioCard: CardTemplate = {
     title: '新场景配置',
     fields: [/* ... */]
   };
   ```

4. 注册 Tool：
   ```typescript
   // apps/chat-agent/src/agent/tools/index.ts
   this.tools.push(newScenarioTool);
   ```

**无需修改**：
- Pi Agent 核心
- Chat Controller
- Session 管理
- 前端 CardRenderer

### 8.2 多模态支持

**未来扩展**：
- 图片上传（数据集示例）
- 语音输入（语音转文字）
- 结果可视化（图表生成）

**设计预留**：
```typescript
interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string | CardMessage | MediaMessage;  // 预留 MediaMessage
  attachments?: Attachment[];  // 预留附件
}
```

## 9. 成本估算

### 9.1 LLM API 成本

**假设**：
- Claude 3.5 Sonnet
- Input: $3 / 1M tokens
- Output: $15 / 1M tokens

**单次对话估算**：
- System prompt: 500 tokens
- 历史消息: 2000 tokens
- 用户消息: 100 tokens
- Tool definitions: 1000 tokens
- Total input: ~3600 tokens
- Output: ~500 tokens

**成本**：
- Input: 3600 × $3 / 1M = $0.0108
- Output: 500 × $15 / 1M = $0.0075
- **Total: ~$0.018 / 对话**

**月度估算**（1000 活跃用户，每人 10 次对话/月）：
- 10,000 对话 × $0.018 = **$180 / 月**

### 9.2 基础设施成本

**Kubernetes 资源**：
- chat-agent: 3 replicas × 1 vCPU × 1GB RAM
- PostgreSQL: 2 vCPU × 4GB RAM
- Redis: 1 vCPU × 2GB RAM

**AWS 估算**：
- EKS: $0.10/hour × 730 = $73/月
- EC2 (t3.medium × 5): $0.0416/hour × 5 × 730 = $152/月
- RDS (db.t3.medium): $0.068/hour × 730 = $50/月
- ElastiCache (cache.t3.micro): $0.017/hour × 730 = $12/月

**Total: ~$287 / 月**

**总成本**: $180 (LLM) + $287 (基础设施) = **~$470 / 月**
