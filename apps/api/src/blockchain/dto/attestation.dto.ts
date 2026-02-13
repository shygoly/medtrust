import { IsString, IsEnum, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum AttestationType {
  PRESCRIPTION = 'prescription',
  MEDICAL_RECORD = 'medical_record',
  DRUG_TRACEABILITY = 'drug_traceability',
  CUSTOM = 'custom',
}

export class CreateAttestationDto {
  @ApiProperty({ enum: AttestationType, example: AttestationType.PRESCRIPTION })
  @IsEnum(AttestationType)
  attestation_type: AttestationType;

  @ApiProperty({ example: 'prescription-12345', required: false })
  @IsOptional()
  @IsString()
  data_id?: string;

  @ApiProperty({ example: 'Raw data to be hashed and attested' })
  @IsString()
  data: string;

  @ApiProperty({
    example: { patient_id: 'P001', doctor_id: 'D001', drug_name: 'Metformin' },
    required: false
  })
  @IsOptional()
  @IsObject()
  metadata?: any;

  @ApiProperty({ example: false, required: false })
  @IsOptional()
  encrypt_metadata?: boolean;
}

export class VerifyAttestationDto {
  @ApiProperty({ example: 'Raw data to verify' })
  @IsString()
  data: string;

  @ApiProperty({ example: 1 })
  @IsOptional()
  attestation_id?: number;
}

export class AttestationResponseDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  attestation_type: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ required: false })
  data_id?: string;

  @ApiProperty()
  data_hash: string;

  @ApiProperty({ required: false })
  transaction_hash?: string;

  @ApiProperty({ required: false })
  block_number?: number;

  @ApiProperty({ required: false })
  metadata?: any;

  @ApiProperty()
  verified: boolean;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ required: false })
  confirmed_at?: Date;
}

export class VerificationResponseDto {
  @ApiProperty()
  valid: boolean;

  @ApiProperty({ required: false })
  attestation?: AttestationResponseDto;

  @ApiProperty({ required: false })
  message?: string;
}
