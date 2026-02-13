# Phase 2: Flower Federated Learning Integration

## Overview
Integrate Flower federated learning framework into MedTrust platform for privacy-preserving medical data computation.

## ADDED Requirements

### Requirement: Flower HTTP Client Service
**Priority**: P0
**Component**: Backend

#### Scenario: Initialize Flower Client
Given the MedTrust API is running
When a compute task is created with method "fl"
Then the system should connect to Flower server at FLOWER_SERVER_URL

#### Scenario: Handle Connection Failures
Given the Flower server is unavailable
When the system tries to submit a task
Then it should retry 3 times with exponential backoff
And return an appropriate error message

#### Scenario: Connection Pool Management
Given multiple concurrent compute tasks
When tasks are submitted to Flower
Then the system should use connection pooling
And not exceed FLOWER_MAX_CONNECTIONS limit

---

### Requirement: Flower Task Service
**Priority**: P0
**Component**: Backend

#### Scenario: Submit FL Task
Given a valid FL task configuration
When submitFLTask() is called
Then the task should be sent to Flower server
And a taskId should be returned
And the ComputeTask status should be updated to "pending"

#### Scenario: Query Task Status
Given a submitted FL task
When getTaskStatus(taskId) is called
Then it should return the current status from Flower
And update the local ComputeTask record

#### Scenario: Get Task Result
Given a completed FL task
When getTaskResult(taskId) is called
Then it should fetch results from Flower
And store them in the local database
And return the result data

#### Scenario: Cancel Task
Given a running FL task
When cancelTask(taskId) is called
Then it should send cancel request to Flower
And update local status to "cancelled"

---

### Requirement: Flower REST API Controller
**Priority**: P0
**Component**: Backend

#### Scenario: POST /api/v1/flower/tasks
Given an authenticated user with "compute:submit" permission
When they POST to /api/v1/flower/tasks with valid data
Then a new FL task should be created
And return 201 with task details

#### Scenario: GET /api/v1/flower/tasks/:id/status
Given an existing FL task
When GET /api/v1/flower/tasks/:id/status is called
Then return current task status and progress

#### Scenario: GET /api/v1/flower/tasks/:id/result
Given a completed FL task
When GET /api/v1/flower/tasks/:id/result is called
Then return task results with metrics and model data

#### Scenario: POST /api/v1/flower/tasks/:id/cancel
Given a running FL task
When POST /api/v1/flower/tasks/:id/cancel is called
Then cancel the task and return success

---

### Requirement: Flower Webhook Handler
**Priority**: P1
**Component**: Backend

#### Scenario: Receive Status Updates
Given Flower server sends webhook notification
When POST /api/v1/flower/webhook receives the payload
Then update corresponding ComputeTask status
And send WebSocket notification to frontend

#### Scenario: Validate Webhook Signature
Given a webhook request from Flower
When the request signature is invalid
Then reject with 401 Unauthorized

---

### Requirement: ComputeTask Integration
**Priority**: P0
**Component**: Backend

#### Scenario: Auto-submit to Flower
Given a ComputeTask is created with method "fl"
When the task is saved to database
Then automatically submit to Flower server
And update task status based on Flower response

#### Scenario: Status Sync
Given a running ComputeTask
When Flower status changes
Then the ComputeTask status should be synchronized
And audit log should record the change

---

### Requirement: Flower Configuration Management
**Priority**: P1
**Component**: Backend

#### Scenario: Multi-server Support
Given multiple Flower servers are configured
When submitting a task
Then route to the appropriate server based on algorithm type

#### Scenario: Health Check
Given Flower servers are configured
When health check runs every 30 seconds
Then update server availability status
And remove unhealthy servers from rotation

---

## Target Files

```
apps/api/src/flower/
├── flower-client.service.ts      # HTTP client for Flower
├── flower-config.service.ts      # Configuration management
├── flower-task.service.ts        # Task lifecycle management
├── flower-monitor.service.ts     # Status monitoring
├── flower-result.service.ts      # Result handling
├── flower-error.handler.ts       # Error handling
├── flower.controller.ts          # REST API
├── flower-webhook.controller.ts  # Webhook handler
├── flower-health.controller.ts   # Health check
├── flower.module.ts              # NestJS module
├── dto/
│   ├── submit-fl-task.dto.ts
│   ├── fl-task-config.dto.ts
│   ├── fl-task-response.dto.ts
│   ├── fl-task-status.dto.ts
│   ├── fl-task-result.dto.ts
│   └── update-fl-task.dto.ts
└── types/
    ├── flower.types.ts
    └── fl-algorithm.types.ts

packages/database/src/entities/
├── flower-task.entity.ts
├── flower-server.entity.ts
└── flower-result.entity.ts
```

## Dependencies
- `@nestjs/axios` - HTTP client
- `@nestjs/config` - Configuration
- `@nestjs/websockets` - WebSocket support
- `rxjs` - Reactive programming

## Configuration

```typescript
// flower.config.ts
export interface FlowerConfig {
  serverUrl: string;
  apiKey?: string;
  requestTimeout: number;
  maxRetries: number;
  maxConnections: number;
  webhookSecret: string;
  healthCheckInterval: number;
}
```

## Environment Variables
```bash
FLOWER_SERVER_URL=http://localhost:8080
FLOWER_API_KEY=optional_key
FLOWER_REQUEST_TIMEOUT=30000
FLOWER_MAX_RETRIES=3
FLOWER_MAX_CONNECTIONS=10
FLOWER_WEBHOOK_SECRET=secret
FLOWER_HEALTH_CHECK_INTERVAL=30000
```

## API Endpoints

```typescript
// Flower Controller
@Controller('api/v1/flower')
export class FlowerController {
  @Post('tasks')
  async submitTask(@Body() dto: SubmitFLTaskDto): Promise<FLTaskResponse>

  @Get('tasks/:id/status')
  async getTaskStatus(@Param('id') id: string): Promise<FLTaskStatus>

  @Get('tasks/:id/result')
  async getTaskResult(@Param('id') id: string): Promise<FLTaskResult>

  @Post('tasks/:id/cancel')
  async cancelTask(@Param('id') id: string): Promise<void>

  @Get('health')
  async getHealth(): Promise<HealthStatus>
}

// Webhook Controller
@Controller('api/v1/flower/webhook')
export class FlowerWebhookController {
  @Post()
  async handleWebhook(@Body() payload: WebhookPayload, @Headers('x-signature') signature: string): Promise<void>
}
```

## Acceptance Criteria

1. **Functionality**
   - [ ] Can submit FL tasks to Flower server
   - [ ] Can query task status in real-time
   - [ ] Can retrieve task results
   - [ ] Can cancel running tasks
   - [ ] Webhook updates work correctly

2. **Reliability**
   - [ ] Connection failures are handled gracefully
   - [ ] Automatic retry with exponential backoff
   - [ ] Connection pooling works correctly
   - [ ] Health check monitors server status

3. **Security**
   - [ ] All endpoints require JWT authentication
   - [ ] Webhook signatures are validated
   - [ ] API keys are stored securely

4. **Performance**
   - [ ] API response time < 500ms
   - [ ] Supports 100 concurrent tasks
   - [ ] WebSocket updates < 100ms latency

## Testing Strategy

```typescript
// Unit tests
- flower-client.service.spec.ts
- flower-task.service.spec.ts
- flower.controller.spec.ts

// E2E tests
- flower.e2e-spec.ts

// Mock server
- flower-server.mock.ts
```
