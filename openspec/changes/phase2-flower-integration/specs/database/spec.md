# Phase 2: Flower Database Schema

## Overview
Database entities for Flower federated learning integration and task result storage.

## ADDED Requirements

### Requirement: Flower Task Entity
**Priority**: P0
**Component**: Database

#### Scenario: Store Flower Task Mapping
Given a compute task is submitted to Flower
When the task is created
Then store Flower-specific task information:
- flowerTaskId (Flower server task ID)
- serverId (which Flower server)
- config (algorithm configuration JSON)
- status (Flower-specific status)
- progress (completion percentage)
- startedAt, completedAt timestamps

#### Scenario: Track Task Progress
Given a task is running on Flower
When progress updates are received
Then update the progress field
And store intermediate results if available

---

### Requirement: Flower Server Entity
**Priority**: P1
**Component**: Database

#### Scenario: Configure Multiple Servers
Given multiple Flower servers are available
When administrators add servers
Then store server configuration:
- serverId, name, url
- apiKey (encrypted)
- status (active/inactive)
- capabilities (supported algorithms)
- healthCheckInterval
- lastHealthCheck, isHealthy

#### Scenario: Health Check History
Given servers are being monitored
When health checks run
Then store check results
And update server availability

---

### Requirement: Flower Result Entity
**Priority**: P0
**Component**: Database

#### Scenario: Store Task Results
Given a Flower task has completed
When results are retrieved
Then store:
- taskId (reference to FlowerTask)
- metrics (accuracy, loss, etc. JSON)
- modelData (model weights/params)
- clientStats (per-client metrics)
- rounds (number of training rounds)
- downloadUrl (if stored externally)

#### Scenario: Query Historical Results
Given users want to compare results
When they query past tasks
Then return results with filtering by date, algorithm, metrics

---

### Requirement: Audit Log Enhancement
**Priority**: P1
**Component**: Database

#### Scenario: Track Flower Operations
Given Flower-related operations occur
When tasks are submitted/updated/completed
Then create audit log entries with:
- action (submit/status_update/complete/cancel)
- taskId
- userId
- timestamp
- details (JSON)

---

## Entity Definitions

### FlowerTaskEntity
```typescript
@Entity('flower_tasks')
export class FlowerTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  computeTaskId: string; // FK to ComputeTask

  @Column()
  flowerTaskId: string; // Flower server task ID

  @Column()
  serverId: string; // FK to FlowerServer

  @Column('json')
  config: {
    algorithmType: string;
    modelType: string;
    datasetConfig: Record<string, any>;
    trainingConfig: Record<string, any>;
    aggregationConfig: Record<string, any>;
  };

  @Column({
    type: 'enum',
    enum: ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  })
  status: string;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ type: 'int', default: 0 })
  currentRound: number;

  @Column({ type: 'int', default: 0 })
  totalRounds: number;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  startedAt: Date;

  @Column({ nullable: true })
  completedAt: Date;

  @OneToOne(() => ComputeTask)
  @JoinColumn({ name: 'computeTaskId' })
  computeTask: ComputeTask;

  @ManyToOne(() => FlowerServer)
  @JoinColumn({ name: 'serverId' })
  server: FlowerServer;

  @OneToOne(() => FlowerResult, result => result.task)
  result: FlowerResult;
}
```

### FlowerServerEntity
```typescript
@Entity('flower_servers')
export class FlowerServer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  apiKey: string; // encrypted

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'maintenance'],
    default: 'active'
  })
  status: string;

  @Column('simple-array')
  capabilities: string[]; // ['fl', 'mpc', 'fedavg', 'fedprox']

  @Column({ default: 30000 })
  requestTimeout: number;

  @Column({ default: 3 })
  maxRetries: number;

  @Column({ default: 30000 })
  healthCheckInterval: number;

  @Column({ nullable: true })
  lastHealthCheck: Date;

  @Column({ default: true })
  isHealthy: boolean;

  @Column({ type: 'text', nullable: true })
  healthCheckError: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => FlowerTask, task => task.server)
  tasks: FlowerTask[];
}
```

### FlowerResultEntity
```typescript
@Entity('flower_results')
export class FlowerResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  taskId: string; // FK to FlowerTask

  @Column('json')
  metrics: {
    finalAccuracy: number;
    finalLoss: number;
    trainingTime: number;
    roundsCompleted: number;
    [key: string]: any;
  };

  @Column('json', { nullable: true })
  roundMetrics: Array<{
    round: number;
    accuracy: number;
    loss: number;
    timestamp: string;
  }>;

  @Column('json', { nullable: true })
  clientStats: Array<{
    clientId: string;
    samples: number;
    accuracy: number;
    loss: number;
  }>;

  @Column({ type: 'text', nullable: true })
  modelData: string; // Serialized model or storage reference

  @Column({ nullable: true })
  modelStorageUrl: string; // External storage URL

  @Column({ type: 'json', nullable: true })
  metadata: {
    algorithmVersion: string;
    frameworkVersion: string;
    [key: string]: any;
  };

  @CreateDateColumn()
  createdAt: Date;

  @OneToOne(() => FlowerTask, task => task.result)
  @JoinColumn({ name: 'taskId' })
  task: FlowerTask;
}
```

### FlowerAuditLogEntity
```typescript
@Entity('flower_audit_logs')
export class FlowerAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  action: string; // 'submit', 'status_update', 'complete', 'cancel', 'error'

  @Column()
  taskId: string;

  @Column()
  userId: string;

  @Column('json', { nullable: true })
  details: Record<string, any>;

  @Column({ nullable: true })
  ipAddress: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

---

## Migration Scripts

### CreateFlowerTables Migration
```typescript
export class CreateFlowerTables implements MigrationInterface {
  name = 'CreateFlowerTables';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // flower_servers table
    await queryRunner.createTable(
      new Table({
        name: 'flower_servers',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid' },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'url', type: 'varchar', length: '512' },
          { name: 'apiKey', type: 'varchar', length: '512', isNullable: true },
          { name: 'status', type: 'enum', enum: ['active', 'inactive', 'maintenance'], default: 'active' },
          { name: 'capabilities', type: 'text' },
          { name: 'requestTimeout', type: 'int', default: 30000 },
          { name: 'maxRetries', type: 'int', default: 3 },
          { name: 'healthCheckInterval', type: 'int', default: 30000 },
          { name: 'lastHealthCheck', type: 'timestamp', isNullable: true },
          { name: 'isHealthy', type: 'boolean', default: true },
          { name: 'healthCheckError', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true
    );

    // flower_tasks table
    await queryRunner.createTable(
      new Table({
        name: 'flower_tasks',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid' },
          { name: 'computeTaskId', type: 'uuid' },
          { name: 'flowerTaskId', type: 'varchar', length: '255' },
          { name: 'serverId', type: 'uuid' },
          { name: 'config', type: 'json' },
          { name: 'status', type: 'enum', enum: ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'], default: 'pending' },
          { name: 'progress', type: 'int', default: 0 },
          { name: 'currentRound', type: 'int', default: 0 },
          { name: 'totalRounds', type: 'int', default: 0 },
          { name: 'errorMessage', type: 'text', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
          { name: 'startedAt', type: 'timestamp', isNullable: true },
          { name: 'completedAt', type: 'timestamp', isNullable: true },
        ],
      }),
      true
    );

    // Foreign keys
    await queryRunner.createForeignKey(
      'flower_tasks',
      new TableForeignKey({
        columnNames: ['computeTaskId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'compute_tasks',
        onDelete: 'CASCADE',
      })
    );

    await queryRunner.createForeignKey(
      'flower_tasks',
      new TableForeignKey({
        columnNames: ['serverId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'flower_servers',
        onDelete: 'SET NULL',
      })
    );

    // flower_results table
    await queryRunner.createTable(
      new Table({
        name: 'flower_results',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid' },
          { name: 'taskId', type: 'uuid' },
          { name: 'metrics', type: 'json' },
          { name: 'roundMetrics', type: 'json', isNullable: true },
          { name: 'clientStats', type: 'json', isNullable: true },
          { name: 'modelData', type: 'text', isNullable: true },
          { name: 'modelStorageUrl', type: 'varchar', length: '512', isNullable: true },
          { name: 'metadata', type: 'json', isNullable: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true
    );

    await queryRunner.createForeignKey(
      'flower_results',
      new TableForeignKey({
        columnNames: ['taskId'],
        referencedColumnNames: ['id'],
        referencedTableName: 'flower_tasks',
        onDelete: 'CASCADE',
      })
    );

    // Indexes
    await queryRunner.createIndex('flower_tasks', new TableIndex({
      name: 'IDX_FLOWER_TASKS_STATUS',
      columnNames: ['status'],
    }));

    await queryRunner.createIndex('flower_tasks', new TableIndex({
      name: 'IDX_FLOWER_TASKS_COMPUTE_TASK',
      columnNames: ['computeTaskId'],
    }));

    await queryRunner.createIndex('flower_results', new TableIndex({
      name: 'IDX_FLOWER_RESULTS_TASK',
      columnNames: ['taskId'],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('flower_results');
    await queryRunner.dropTable('flower_tasks');
    await queryRunner.dropTable('flower_servers');
  }
}
```

---

## Indexes

```sql
-- Performance indexes
CREATE INDEX idx_flower_tasks_status ON flower_tasks(status);
CREATE INDEX idx_flower_tasks_server ON flower_tasks(serverId);
CREATE INDEX idx_flower_tasks_created ON flower_tasks(createdAt DESC);
CREATE INDEX idx_flower_results_metrics ON flower_results USING GIN(metrics);
```

---

## Relationships

```
ComputeTask (1) --- (1) FlowerTask
FlowerTask (N) --- (1) FlowerServer
FlowerTask (1) --- (1) FlowerResult
```

---

## Seed Data

```typescript
// Default Flower server
const defaultServer = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Local Flower Server',
  url: 'http://localhost:8080',
  status: 'active',
  capabilities: ['fl', 'fedavg', 'fedprox', 'scaffold'],
  isHealthy: true,
};
```

---

## Target Files

```
packages/database/src/entities/
├── flower-task.entity.ts
├── flower-server.entity.ts
├── flower-result.entity.ts
└── index.ts (update exports)

packages/database/src/migrations/
├── xxx-create-flower-tables.ts
└── xxx-seed-flower-server.ts

packages/database/src/
└── index.ts (update exports)
```

---

## Acceptance Criteria

1. **Entity Definitions**
   - [ ] All entities have proper TypeORM decorators
   - [ ] Relationships are correctly defined
   - [ ] Indexes are created for query performance
   - [ ] Soft delete is supported where appropriate

2. **Migrations**
   - [ ] Up migration creates all tables
   - [ ] Down migration drops all tables
   - [ ] Foreign keys are properly defined
   - [ ] Seed data is inserted

3. **Integration**
   - [ ] Entities are exported from database package
   - [ ] ComputeTask entity is updated with FlowerTask relation
   - [ ] Migration runs successfully
   - [ ] No breaking changes to existing entities

## Dependencies

- TypeORM 0.3.x
- SQLite 3 / PostgreSQL (for production)
- typeorm-naming-strategies (optional)
