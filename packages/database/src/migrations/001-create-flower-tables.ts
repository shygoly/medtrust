import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateFlowerTables implements MigrationInterface {
  name = 'CreateFlowerTables';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create flower_servers table
    await queryRunner.createTable(
      new Table({
        name: 'flower_servers',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'name', type: 'varchar', length: '255' },
          { name: 'url', type: 'varchar', length: '512' },
          { name: 'api_key', type: 'varchar', length: '512', isNullable: true },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'active'",
          },
          { name: 'capabilities', type: 'text' },
          { name: 'request_timeout', type: 'integer', default: 30000 },
          { name: 'max_retries', type: 'integer', default: 3 },
          { name: 'health_check_interval', type: 'integer', default: 30000 },
          { name: 'last_health_check', type: 'datetime', isNullable: true },
          { name: 'is_healthy', type: 'boolean', default: true },
          { name: 'health_check_error', type: 'text', isNullable: true },
          {
            name: 'created_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true
    );

    // Create flower_tasks table
    await queryRunner.createTable(
      new Table({
        name: 'flower_tasks',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'compute_task_id', type: 'integer' },
          { name: 'flower_task_id', type: 'varchar', length: '255' },
          { name: 'server_id', type: 'integer' },
          { name: 'config', type: 'text' },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'pending'",
          },
          { name: 'progress', type: 'integer', default: 0 },
          { name: 'current_round', type: 'integer', default: 0 },
          { name: 'total_rounds', type: 'integer', default: 0 },
          { name: 'error_message', type: 'text', isNullable: true },
          {
            name: 'created_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          { name: 'started_at', type: 'datetime', isNullable: true },
          { name: 'completed_at', type: 'datetime', isNullable: true },
        ],
      }),
      true
    );

    // Create flower_results table
    await queryRunner.createTable(
      new Table({
        name: 'flower_results',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'task_id', type: 'integer' },
          { name: 'metrics', type: 'text' },
          { name: 'round_metrics', type: 'text', isNullable: true },
          { name: 'client_stats', type: 'text', isNullable: true },
          { name: 'model_data', type: 'text', isNullable: true },
          { name: 'model_storage_url', type: 'varchar', length: '512', isNullable: true },
          { name: 'metadata', type: 'text', isNullable: true },
          {
            name: 'created_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true
    );

    // Create flower_audit_logs table
    await queryRunner.createTable(
      new Table({
        name: 'flower_audit_logs',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'action', type: 'varchar', length: '20' },
          { name: 'task_id', type: 'integer' },
          { name: 'user_id', type: 'integer' },
          { name: 'details', type: 'text', isNullable: true },
          { name: 'ip_address', type: 'varchar', length: '45', isNullable: true },
          {
            name: 'created_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true
    );

    // Add foreign keys
    await queryRunner.createForeignKey(
      'flower_tasks',
      new TableForeignKey({
        columnNames: ['compute_task_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'compute_tasks',
        onDelete: 'CASCADE',
      })
    );

    await queryRunner.createForeignKey(
      'flower_tasks',
      new TableForeignKey({
        columnNames: ['server_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'flower_servers',
        onDelete: 'SET NULL',
      })
    );

    await queryRunner.createForeignKey(
      'flower_results',
      new TableForeignKey({
        columnNames: ['task_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'flower_tasks',
        onDelete: 'CASCADE',
      })
    );

    // Add indexes
    await queryRunner.createIndex(
      'flower_servers',
      new TableIndex({
        name: 'IDX_FLOWER_SERVERS_STATUS',
        columnNames: ['status'],
      })
    );

    await queryRunner.createIndex(
      'flower_servers',
      new TableIndex({
        name: 'IDX_FLOWER_SERVERS_HEALTH',
        columnNames: ['is_healthy'],
      })
    );

    await queryRunner.createIndex(
      'flower_tasks',
      new TableIndex({
        name: 'IDX_FLOWER_TASKS_STATUS',
        columnNames: ['status'],
      })
    );

    await queryRunner.createIndex(
      'flower_tasks',
      new TableIndex({
        name: 'IDX_FLOWER_TASKS_COMPUTE_TASK',
        columnNames: ['compute_task_id'],
      })
    );

    await queryRunner.createIndex(
      'flower_tasks',
      new TableIndex({
        name: 'IDX_FLOWER_TASKS_SERVER',
        columnNames: ['server_id'],
      })
    );

    await queryRunner.createIndex(
      'flower_tasks',
      new TableIndex({
        name: 'IDX_FLOWER_TASKS_CREATED',
        columnNames: ['created_at'],
      })
    );

    await queryRunner.createIndex(
      'flower_results',
      new TableIndex({
        name: 'IDX_FLOWER_RESULTS_TASK',
        columnNames: ['task_id'],
      })
    );

    await queryRunner.createIndex(
      'flower_audit_logs',
      new TableIndex({
        name: 'IDX_FLOWER_AUDIT_ACTION',
        columnNames: ['action'],
      })
    );

    await queryRunner.createIndex(
      'flower_audit_logs',
      new TableIndex({
        name: 'IDX_FLOWER_AUDIT_TASK',
        columnNames: ['task_id'],
      })
    );

    await queryRunner.createIndex(
      'flower_audit_logs',
      new TableIndex({
        name: 'IDX_FLOWER_AUDIT_USER',
        columnNames: ['user_id'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order (respect foreign keys)
    await queryRunner.dropTable('flower_audit_logs');
    await queryRunner.dropTable('flower_results');
    await queryRunner.dropTable('flower_tasks');
    await queryRunner.dropTable('flower_servers');
  }
}
