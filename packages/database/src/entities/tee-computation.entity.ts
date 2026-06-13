import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from './tenant.entity';

export enum TeeComputationStatus {
  PROVISIONING = 'provisioning',
  READY = 'ready',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TERMINATED = 'terminated',
}

export enum TeeComputationType {
  GENE_ANALYSIS = 'gene_analysis',
  DRUG_EFFICACY = 'drug_efficacy',
  CUSTOM = 'custom',
}

@Entity('tee_computations')
@Index(['tenantId'])
@Index(['status'])
@Index(['instanceId'])
@Index(['createdAt'])
export class TeeComputation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id' })
  tenantId: number;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'simple-enum',
    enum: TeeComputationStatus,
    default: TeeComputationStatus.PROVISIONING,
  })
  status: TeeComputationStatus;

  @Column({
    type: 'simple-enum',
    enum: TeeComputationType,
    name: 'computation_type',
  })
  computationType: TeeComputationType;

  // Alibaba Cloud SGX instance
  @Column({ length: 100, nullable: true, name: 'instance_id' })
  instanceId: string;

  @Column({ length: 50, nullable: true, name: 'instance_type' })
  instanceType: string;

  @Column({ length: 50, nullable: true, name: 'region' })
  region: string;

  @Column({ length: 100, nullable: true, name: 'public_ip' })
  publicIp: string;

  // Remote attestation
  @Column({ type: 'text', nullable: true, name: 'attestation_report' })
  attestationReport: string;

  @Column({ nullable: true, name: 'attestation_verified_at' })
  attestationVerifiedAt: Date;

  @Column({ type: 'boolean', default: false, name: 'attestation_valid' })
  attestationValid: boolean;

  // Computation configuration
  @Column({ type: 'text', nullable: true, name: 'enclave_code_hash' })
  enclaveCodeHash: string;

  @Column({ type: 'simple-json', nullable: true, name: 'computation_params' })
  computationParams: any;

  // Input data (encrypted)
  @Column({ type: 'text', nullable: true, name: 'encrypted_input_path' })
  encryptedInputPath: string;

  @Column({ type: 'text', nullable: true, name: 'input_encryption_key' })
  inputEncryptionKey: string;

  // Output data (encrypted with user public key)
  @Column({ type: 'text', nullable: true, name: 'encrypted_output_path' })
  encryptedOutputPath: string;

  @Column({ type: 'text', nullable: true, name: 'user_public_key' })
  userPublicKey: string;

  // Resource usage
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'cpu_hours' })
  cpuHours: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'memory_gb_hours' })
  memoryGbHours: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, name: 'cost_cny' })
  costCny: number;

  // Error handling
  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string;

  // Timestamps
  @Column({ nullable: true, name: 'provisioned_at' })
  provisionedAt: Date;

  @Column({ nullable: true, name: 'started_at' })
  startedAt: Date;

  @Column({ nullable: true, name: 'completed_at' })
  completedAt: Date;

  @Column({ nullable: true, name: 'terminated_at' })
  terminatedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
