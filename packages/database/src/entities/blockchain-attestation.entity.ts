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

export enum AttestationType {
  PRESCRIPTION = 'prescription',
  MEDICAL_RECORD = 'medical_record',
  DRUG_TRACEABILITY = 'drug_traceability',
  CUSTOM = 'custom',
}

export enum AttestationStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

@Entity('blockchain_attestations')
@Index(['tenant_id'])
@Index(['attestation_type'])
@Index(['transaction_hash'])
@Index(['data_hash'])
@Index(['created_at'])
export class BlockchainAttestation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'tenant_id' })
  tenantId: number;

  @ManyToOne(() => Tenant)
  @JoinColumn({ name: 'tenant_id' })
  tenant: Tenant;

  @Column({
    type: 'simple-enum',
    enum: AttestationType,
    name: 'attestation_type',
  })
  attestationType: AttestationType;

  @Column({
    type: 'simple-enum',
    enum: AttestationStatus,
    default: AttestationStatus.PENDING,
  })
  status: AttestationStatus;

  // Data identification
  @Column({ length: 100, nullable: true, name: 'data_id' })
  dataId: string;

  @Column({ length: 64, name: 'data_hash' })
  dataHash: string;

  @Column({ length: 20, default: 'SM3', name: 'hash_algorithm' })
  hashAlgorithm: string;

  // Blockchain transaction
  @Column({ length: 66, nullable: true, name: 'transaction_hash' })
  transactionHash: string;

  @Column({ type: 'bigint', nullable: true, name: 'block_number' })
  blockNumber: number;

  @Column({ length: 42, nullable: true, name: 'contract_address' })
  contractAddress: string;

  // Metadata (encrypted with SM4 if sensitive)
  @Column({ type: 'simple-json', nullable: true })
  metadata: {
    patient_id?: string;
    doctor_id?: string;
    drug_name?: string;
    batch_id?: string;
    [key: string]: any;
  };

  @Column({ type: 'boolean', default: false, name: 'metadata_encrypted' })
  metadataEncrypted: boolean;

  // Prescription flow tracking
  @Column({ length: 100, nullable: true, name: 'prescription_id' })
  prescriptionId: string;

  @Column({ length: 20, nullable: true, name: 'prescription_status' })
  prescriptionStatus: string; // issued, dispensed

  @Column({ nullable: true, name: 'parent_attestation_id' })
  parentAttestationId: number;

  @ManyToOne(() => BlockchainAttestation)
  @JoinColumn({ name: 'parent_attestation_id' })
  parentAttestation: BlockchainAttestation;

  // Signing information
  @Column({ length: 42, nullable: true, name: 'signer_address' })
  signerAddress: string;

  @Column({ type: 'text', nullable: true })
  signature: string;

  // Verification
  @Column({ type: 'boolean', default: false, name: 'verified' })
  verified: boolean;

  @Column({ nullable: true, name: 'verified_at' })
  verifiedAt: Date;

  // Error handling
  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string;

  // Timestamps
  @Column({ nullable: true, name: 'confirmed_at' })
  confirmedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
