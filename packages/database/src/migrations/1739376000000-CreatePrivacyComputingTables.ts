import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreatePrivacyComputingTables1739376000000
  implements MigrationInterface
{
  name = 'CreatePrivacyComputingTables1739376000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create federated_learning_jobs table
    await queryRunner.createTable(
      new Table({
        name: 'federated_learning_jobs',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'tenant_id', type: 'integer' },
          { name: 'name', type: 'varchar', length: '200' },
          { name: 'description', type: 'text', isNullable: true },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'pending'",
          },
          { name: 'fl_type', type: 'varchar', length: '20' },
          { name: 'algorithm', type: 'varchar', length: '50' },
          { name: 'fate_job_id', type: 'varchar', length: '100', isNullable: true },
          { name: 'participants', type: 'text' },
          { name: 'training_params', type: 'text', isNullable: true },
          { name: 'dataset_refs', type: 'text', isNullable: true },
          { name: 'current_epoch', type: 'integer', default: 0 },
          { name: 'total_epochs', type: 'integer', isNullable: true },
          { name: 'progress_percentage', type: 'decimal', precision: 5, scale: 2, isNullable: true },
          { name: 'model_path', type: 'text', isNullable: true },
          { name: 'model_metrics', type: 'text', isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'started_at', type: 'datetime', isNullable: true },
          { name: 'completed_at', type: 'datetime', isNullable: true },
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
      true,
    );

    // Create mpc_sessions table
    await queryRunner.createTable(
      new Table({
        name: 'mpc_sessions',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'tenant_id', type: 'integer' },
          { name: 'session_id', type: 'varchar', length: '100', isUnique: true },
          { name: 'name', type: 'varchar', length: '200' },
          { name: 'description', type: 'text', isNullable: true },
          {
            name: 'status',
            type: 'varchar',
            length: '30',
            default: "'waiting_for_shares'",
          },
          { name: 'computation_type', type: 'varchar', length: '30' },
          { name: 'participants', type: 'text' },
          { name: 'total_participants', type: 'integer' },
          { name: 'shares_received', type: 'integer', default: 0 },
          { name: 'mpc_protocol', type: 'varchar', length: '50', default: "'shamir'" },
          { name: 'threshold', type: 'integer', isNullable: true },
          { name: 'result', type: 'decimal', precision: 20, scale: 10, isNullable: true },
          { name: 'result_metadata', type: 'text', isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'timeout_seconds', type: 'integer', default: 300 },
          { name: 'expires_at', type: 'datetime', isNullable: true },
          { name: 'started_at', type: 'datetime', isNullable: true },
          { name: 'completed_at', type: 'datetime', isNullable: true },
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
      true,
    );

    // Create tee_computations table
    await queryRunner.createTable(
      new Table({
        name: 'tee_computations',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'tenant_id', type: 'integer' },
          { name: 'name', type: 'varchar', length: '200' },
          { name: 'description', type: 'text', isNullable: true },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'provisioning'",
          },
          { name: 'computation_type', type: 'varchar', length: '30' },
          { name: 'instance_id', type: 'varchar', length: '100', isNullable: true },
          { name: 'instance_type', type: 'varchar', length: '50', isNullable: true },
          { name: 'region', type: 'varchar', length: '50', isNullable: true },
          { name: 'public_ip', type: 'varchar', length: '100', isNullable: true },
          { name: 'attestation_report', type: 'text', isNullable: true },
          { name: 'attestation_verified_at', type: 'datetime', isNullable: true },
          { name: 'attestation_valid', type: 'boolean', default: false },
          { name: 'enclave_code_hash', type: 'text', isNullable: true },
          { name: 'computation_params', type: 'text', isNullable: true },
          { name: 'encrypted_input_path', type: 'text', isNullable: true },
          { name: 'input_encryption_key', type: 'text', isNullable: true },
          { name: 'encrypted_output_path', type: 'text', isNullable: true },
          { name: 'user_public_key', type: 'text', isNullable: true },
          { name: 'cpu_hours', type: 'decimal', precision: 10, scale: 2, isNullable: true },
          { name: 'memory_gb_hours', type: 'decimal', precision: 10, scale: 2, isNullable: true },
          { name: 'cost_cny', type: 'decimal', precision: 10, scale: 2, isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'provisioned_at', type: 'datetime', isNullable: true },
          { name: 'started_at', type: 'datetime', isNullable: true },
          { name: 'completed_at', type: 'datetime', isNullable: true },
          { name: 'terminated_at', type: 'datetime', isNullable: true },
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
      true,
    );

    // Create blockchain_attestations table
    await queryRunner.createTable(
      new Table({
        name: 'blockchain_attestations',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'tenant_id', type: 'integer' },
          { name: 'attestation_type', type: 'varchar', length: '30' },
          {
            name: 'status',
            type: 'varchar',
            length: '20',
            default: "'pending'",
          },
          { name: 'data_id', type: 'varchar', length: '100', isNullable: true },
          { name: 'data_hash', type: 'varchar', length: '64' },
          { name: 'hash_algorithm', type: 'varchar', length: '20', default: "'SM3'" },
          { name: 'transaction_hash', type: 'varchar', length: '66', isNullable: true },
          { name: 'block_number', type: 'bigint', isNullable: true },
          { name: 'contract_address', type: 'varchar', length: '42', isNullable: true },
          { name: 'metadata', type: 'text', isNullable: true },
          { name: 'metadata_encrypted', type: 'boolean', default: false },
          { name: 'prescription_id', type: 'varchar', length: '100', isNullable: true },
          { name: 'prescription_status', type: 'varchar', length: '20', isNullable: true },
          { name: 'parent_attestation_id', type: 'integer', isNullable: true },
          { name: 'signer_address', type: 'varchar', length: '42', isNullable: true },
          { name: 'signature', type: 'text', isNullable: true },
          { name: 'verified', type: 'boolean', default: false },
          { name: 'verified_at', type: 'datetime', isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'confirmed_at', type: 'datetime', isNullable: true },
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
      true,
    );

    // Add foreign keys
    await queryRunner.createForeignKey(
      'federated_learning_jobs',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'mpc_sessions',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'tee_computations',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'blockchain_attestations',
      new TableForeignKey({
        columnNames: ['tenant_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'tenants',
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'blockchain_attestations',
      new TableForeignKey({
        columnNames: ['parent_attestation_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'blockchain_attestations',
        onDelete: 'SET NULL',
      }),
    );

    // Add indexes for federated_learning_jobs
    await queryRunner.createIndex(
      'federated_learning_jobs',
      new TableIndex({
        name: 'IDX_FL_JOBS_TENANT',
        columnNames: ['tenant_id'],
      }),
    );

    await queryRunner.createIndex(
      'federated_learning_jobs',
      new TableIndex({
        name: 'IDX_FL_JOBS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'federated_learning_jobs',
      new TableIndex({
        name: 'IDX_FL_JOBS_CREATED',
        columnNames: ['created_at'],
      }),
    );

    // Add indexes for mpc_sessions
    await queryRunner.createIndex(
      'mpc_sessions',
      new TableIndex({
        name: 'IDX_MPC_SESSIONS_TENANT',
        columnNames: ['tenant_id'],
      }),
    );

    await queryRunner.createIndex(
      'mpc_sessions',
      new TableIndex({
        name: 'IDX_MPC_SESSIONS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'mpc_sessions',
      new TableIndex({
        name: 'IDX_MPC_SESSIONS_CREATED',
        columnNames: ['created_at'],
      }),
    );

    // Add indexes for tee_computations
    await queryRunner.createIndex(
      'tee_computations',
      new TableIndex({
        name: 'IDX_TEE_COMPUTATIONS_TENANT',
        columnNames: ['tenant_id'],
      }),
    );

    await queryRunner.createIndex(
      'tee_computations',
      new TableIndex({
        name: 'IDX_TEE_COMPUTATIONS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'tee_computations',
      new TableIndex({
        name: 'IDX_TEE_COMPUTATIONS_INSTANCE',
        columnNames: ['instance_id'],
      }),
    );

    await queryRunner.createIndex(
      'tee_computations',
      new TableIndex({
        name: 'IDX_TEE_COMPUTATIONS_CREATED',
        columnNames: ['created_at'],
      }),
    );

    // Add indexes for blockchain_attestations
    await queryRunner.createIndex(
      'blockchain_attestations',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_ATTESTATIONS_TENANT',
        columnNames: ['tenant_id'],
      }),
    );

    await queryRunner.createIndex(
      'blockchain_attestations',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_ATTESTATIONS_TYPE',
        columnNames: ['attestation_type'],
      }),
    );

    await queryRunner.createIndex(
      'blockchain_attestations',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_ATTESTATIONS_TX_HASH',
        columnNames: ['transaction_hash'],
      }),
    );

    await queryRunner.createIndex(
      'blockchain_attestations',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_ATTESTATIONS_DATA_HASH',
        columnNames: ['data_hash'],
      }),
    );

    await queryRunner.createIndex(
      'blockchain_attestations',
      new TableIndex({
        name: 'IDX_BLOCKCHAIN_ATTESTATIONS_CREATED',
        columnNames: ['created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order (respect foreign keys)
    await queryRunner.dropTable('blockchain_attestations');
    await queryRunner.dropTable('tee_computations');
    await queryRunner.dropTable('mpc_sessions');
    await queryRunner.dropTable('federated_learning_jobs');
  }
}
