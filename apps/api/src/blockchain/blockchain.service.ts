import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainAttestation, AttestationStatus } from '@medtrust/database';
import { ChainAdapter } from './adapters/chain.adapter';
import { CreateAttestationDto, VerifyAttestationDto, AttestationResponseDto, VerificationResponseDto } from './dto/attestation.dto';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);

  constructor(
    @InjectRepository(BlockchainAttestation)
    private readonly attestationRepository: Repository<BlockchainAttestation>,
    private readonly chainAdapter: ChainAdapter,
  ) {}

  async createAttestation(tenantId: number, dto: CreateAttestationDto): Promise<AttestationResponseDto> {
    // Compute SM3 hash of data
    const dataHash = this.chainAdapter.computeSM3Hash(dto.data);

    // Check for duplicate attestation
    const existing = await this.attestationRepository.findOne({
      where: { dataHash, tenantId },
    });

    if (existing) {
      throw new ConflictException(`Data already attested with ID: ${existing.id}`);
    }

    // Create attestation record
    const attestation = this.attestationRepository.create({
      tenantId,
      attestationType: dto.attestation_type,
      dataId: dto.data_id,
      dataHash,
      hashAlgorithm: 'SM3',
      metadata: dto.metadata,
      metadataEncrypted: dto.encrypt_metadata || false,
      status: AttestationStatus.PENDING,
    });

    await this.attestationRepository.save(attestation);

    // Submit to blockchain asynchronously
    this.submitToBlockchain(attestation.id).catch((error) => {
      this.logger.error(`Failed to submit attestation ${attestation.id} to blockchain: ${error.message}`);
    });

    return this.toResponseDto(attestation);
  }

  async verifyAttestation(tenantId: number, dto: VerifyAttestationDto): Promise<VerificationResponseDto> {
    const dataHash = this.chainAdapter.computeSM3Hash(dto.data);

    // Query local database first
    let attestation: BlockchainAttestation;

    if (dto.attestation_id) {
      attestation = await this.attestationRepository.findOne({
        where: { id: dto.attestation_id },
      });

      if (!attestation) {
        throw new NotFoundException(`Attestation ${dto.attestation_id} not found`);
      }

      // Verify hash matches
      if (attestation.dataHash !== dataHash) {
        return {
          valid: false,
          message: 'Data hash mismatch - data has been tampered',
        };
      }
    } else {
      // Find by hash
      attestation = await this.attestationRepository.findOne({
        where: { dataHash },
      });

      if (!attestation) {
        return {
          valid: false,
          message: 'No attestation found for this data',
        };
      }
    }

    // Verify against blockchain
    const blockchainResult = await this.chainAdapter.verifyAttestation(dataHash);

    if (blockchainResult.valid) {
      attestation.verified = true;
      attestation.verifiedAt = new Date();
      await this.attestationRepository.save(attestation);
    }

    return {
      valid: blockchainResult.valid,
      attestation: this.toResponseDto(attestation),
    };
  }

  async getAttestations(
    tenantId: number,
    filters?: {
      attestation_type?: string;
      data_id?: string;
      from_date?: Date;
      to_date?: Date;
    },
  ): Promise<AttestationResponseDto[]> {
    const query = this.attestationRepository.createQueryBuilder('attestation');
    let hasWhere = false;
    if (typeof tenantId === 'number') {
      query.where('attestation.tenantId = :tenantId', { tenantId });
      hasWhere = true;
    }

    if (filters?.attestation_type) {
      const method = hasWhere ? 'andWhere' : 'where';
      query[method]('attestation.attestationType = :type', { type: filters.attestation_type });
      hasWhere = true;
    }

    if (filters?.data_id) {
      const method = hasWhere ? 'andWhere' : 'where';
      query[method]('attestation.dataId = :dataId', { dataId: filters.data_id });
      hasWhere = true;
    }

    if (filters?.from_date) {
      const method = hasWhere ? 'andWhere' : 'where';
      query[method]('attestation.createdAt >= :fromDate', { fromDate: filters.from_date });
      hasWhere = true;
    }

    if (filters?.to_date) {
      const method = hasWhere ? 'andWhere' : 'where';
      query[method]('attestation.createdAt <= :toDate', { toDate: filters.to_date });
    }

    query.orderBy('attestation.createdAt', 'DESC');

    const attestations = await query.getMany();
    return attestations.map((a) => this.toResponseDto(a));
  }

  async getAttestation(tenantId: number, attestationId: number): Promise<AttestationResponseDto> {
    const attestation = await this.attestationRepository.findOne({
      where: { id: attestationId, tenantId },
    });

    if (!attestation) {
      throw new NotFoundException(`Attestation ${attestationId} not found`);
    }

    return this.toResponseDto(attestation);
  }

  private async submitToBlockchain(attestationId: number): Promise<void> {
    const attestation = await this.attestationRepository.findOne({ where: { id: attestationId } });
    if (!attestation) return;

    try {
      const result = await this.chainAdapter.submitAttestation({
        data_id: attestation.dataId,
        data_hash: attestation.dataHash,
        metadata: attestation.metadata,
        signer_address: '0x0000000000000000000000000000000000000000', // Mock address
      });

      attestation.transactionHash = result.transaction_hash;
      attestation.blockNumber = result.block_number;
      attestation.contractAddress = result.contract_address;
      attestation.status = AttestationStatus.CONFIRMED;
      attestation.confirmedAt = new Date();

      await this.attestationRepository.save(attestation);

      this.logger.log(`Attestation ${attestationId} confirmed on blockchain: ${result.transaction_hash}`);
    } catch (error) {
      attestation.status = AttestationStatus.FAILED;
      attestation.errorMessage = error.message;
      await this.attestationRepository.save(attestation);

      this.logger.error(`Failed to submit attestation ${attestationId}: ${error.message}`);
    }
  }

  private toResponseDto(attestation: BlockchainAttestation): AttestationResponseDto {
    return {
      id: attestation.id,
      attestation_type: attestation.attestationType,
      status: attestation.status,
      data_id: attestation.dataId,
      data_hash: attestation.dataHash,
      transaction_hash: attestation.transactionHash,
      block_number: attestation.blockNumber ? Number(attestation.blockNumber) : undefined,
      metadata: attestation.metadata,
      verified: attestation.verified,
      created_at: attestation.createdAt,
      confirmed_at: attestation.confirmedAt,
    };
  }
}
