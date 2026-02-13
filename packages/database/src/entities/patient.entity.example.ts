import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

// Note: EncryptedColumn decorator would be imported from apps/api/src/security/decorators
// This is an example showing the pattern - actual implementation would need proper imports

@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  // Encrypted fields - these would use @EncryptedColumn decorator in actual implementation
  // @EncryptedColumn('patient-id-card-key', { length: 500 })
  @Column({ length: 500, comment: 'Encrypted with patient-id-card-key' })
  idCard: string;

  // @EncryptedColumn('patient-contact-key', { length: 500 })
  @Column({ length: 500, comment: 'Encrypted with patient-contact-key' })
  phoneNumber: string;

  // @EncryptedColumn('patient-medical-history-key', { length: 1000 })
  @Column({ type: 'text', comment: 'Encrypted with patient-medical-history-key' })
  medicalHistory: string;

  @Column({ type: 'int' })
  age: number;

  @Column({ length: 10 })
  gender: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({ length: 255, nullable: true })
  email: string;

  @Column({ default: true })
  isActive: boolean;

  // FHIR R4 resource representation
  @Column({ type: 'simple-json', nullable: true, name: 'fhir_resource' })
  fhirResource: {
    resourceType: 'Patient';
    id?: string;
    identifier?: any[];
    name?: any[];
    telecom?: any[];
    gender?: string;
    birthDate?: string;
    address?: any[];
    [key: string]: any;
  };

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ nullable: true, name: 'deleted_at' })
  deletedAt: Date;
}
