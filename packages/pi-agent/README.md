# @medtrust/pi-agent

Lightweight Pi Agent runtime for building LLM-powered conversational agents.

## Features

- 🪶 **Lightweight**: Core runtime < 500 LoC
- 🔧 **Tool-driven**: Extend agent capabilities through simple Tool interface
- 🔄 **Stateless**: No session management, pure function-based design
- 🎯 **Type-safe**: Full TypeScript support with strict typing
- 🧩 **LLM-agnostic**: Support multiple LLM providers (Anthropic, OpenAI, etc.)

## Installation

```bash
pnpm add @medtrust/pi-agent
```

## Quick Start

```typescript
import { PiAgent, AnthropicClient } from '@medtrust/pi-agent';
import type { Tool } from '@medtrust/pi-agent';

// 1. Define your tools
const weatherTool: Tool = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name'
      }
    },
    required: ['location']
  },
  execute: async (params, context) => {
    const { location } = params as { location: string };
    // Call weather API
    return {
      success: true,
      data: { temperature: 72, condition: 'sunny' }
    };
  }
};

// 2. Create LLM client
const llm = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-5-sonnet-20241022'
});

// 3. Create agent
const agent = new PiAgent(
  {
    systemPrompt: 'You are a helpful weather assistant.'
  },
  [weatherTool],
  llm
);

// 4. Set context
agent.setContext({
  userId: 'user-123',
  spaceId: 'space-456',
  sessionId: 'session-789'
});

// 5. Chat
const response = await agent.chat('What is the weather in Beijing?');
console.log(response.content);
// => "The weather in Beijing is currently sunny with a temperature of 72°F."
```

## Core Concepts

### Agent

The `PiAgent` class is the core runtime that:
- Manages conversation flow
- Calls LLM with tools
- Executes tool calls
- Returns responses

```typescript
const agent = new PiAgent(config, tools, llm);
agent.setContext(context);
const response = await agent.chat(userMessage, history);
```

### Tool

A `Tool` is a function the agent can call to perform actions:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
}
```

Example:

```typescript
const submitTaskTool: Tool = {
  name: 'submit_task',
  description: 'Submit a computation task',
  parameters: {
    type: 'object',
    properties: {
      taskType: {
        type: 'string',
        enum: ['prediction', 'analysis']
      },
      participants: {
        type: 'array',
        items: { type: 'string' }
      }
    },
    required: ['taskType', 'participants']
  },
  execute: async (params, context) => {
    // Call API to submit task
    const result = await api.submitTask(params);
    return {
      success: true,
      data: { taskId: result.id }
    };
  }
};
```

### LLM Client

Implement the `LLMClient` interface to support different LLM providers:

```typescript
interface LLMClient {
  complete(messages: LLMMessage[], tools: Tool[]): Promise<LLMResponse>;
}
```

Built-in clients:
- `AnthropicClient`: Claude models

### Context

Tool execution context carries information about the current session:

```typescript
interface ToolContext {
  userId: string;
  spaceId: string;
  sessionId: string;
  [key: string]: unknown;  // Custom fields
}
```

## Advanced Usage

### Conversation History

Pass previous messages as history:

```typescript
const history = [
  { role: 'user', content: 'What is the weather?' },
  { role: 'assistant', content: 'The weather is sunny.' }
];

const response = await agent.chat('What did I ask about?', history);
```

### Custom Context Fields

Add custom fields to context:

```typescript
agent.setContext({
  userId: 'user-123',
  spaceId: 'space-456',
  sessionId: 'session-789',
  apiToken: 'secret-token',  // Custom field
  organizationId: 'org-999'   // Custom field
});
```

Access in tool:

```typescript
execute: async (params, context) => {
  const token = context.apiToken as string;
  // Use token for API calls
}
```

### Error Handling

Tools should return structured errors:

```typescript
execute: async (params, context) => {
  try {
    const result = await apiCall(params);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
```

### Parameter Validation

Parameters are automatically validated against the schema. Invalid parameters return an error to the LLM.

```typescript
// Tool definition
parameters: {
  type: 'object',
  properties: {
    age: {
      type: 'number',
      minimum: 0,
      maximum: 120
    }
  },
  required: ['age']
}

// Validation errors:
// - Missing required parameter: age
// - age: expected number, got string
// - age: must be >= 0
```

## Configuration

### Agent Config

```typescript
interface AgentConfig {
  systemPrompt: string;      // System instructions
  maxTokens?: number;        // Max output tokens (default: 4096)
  temperature?: number;      // LLM temperature (default: 1.0)
}
```

### Anthropic Client Config

```typescript
interface AnthropicConfig {
  apiKey: string;
  model?: string;            // Default: 'claude-3-5-sonnet-20241022'
  maxTokens?: number;        // Default: 4096
  temperature?: number;      // Default: 1.0
}
```

## Testing

The package includes comprehensive tests:

```bash
# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:cov
```

## API Reference

### PiAgent

#### Constructor

```typescript
constructor(config: AgentConfig, tools: Tool[], llm: LLMClient)
```

#### Methods

- `setContext(context: ToolContext): void` - Set tool execution context
- `chat(userMessage: string, history?: Message[]): Promise<AgentResponse>` - Process user message

### Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
}
```

### LLMClient Interface

```typescript
interface LLMClient {
  complete(messages: LLMMessage[], tools: Tool[]): Promise<LLMResponse>;
}
```

## Examples

See [examples/](./examples/) for more usage examples:
- Basic chat
- Multi-turn conversation
- Tool calling
- Error handling
- Custom LLM client

## License

UNLICENSED
