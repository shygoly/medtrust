import { Test, TestingModule } from '@nestjs/testing';
import { BlockchainService } from './blockchain.service';
import { FiscoBcosAdapter } from './adapters/fisco-bcos.adapter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BlockchainAttestation, AttestationStatus } from '@medtrust/database';
import { Repository } from 'typeorm';

describe('BlockchainService', () => {
  let service: BlockchainService;
  let repository: Repository<BlockchainAttestation>;
  let fiscoBcosAdapter: FiscoBcosAdapter;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  };

  const mockFiscoBcosAdapter = {
    submitAttestation: jest.fn(),
    verifyAttestation: jest.fn(),
    computeSM3Hash: jest.fn(),
    queryAttestationHistory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BlockchainService,
        {
          provide: getRepositoryToken(BlockchainAttestation),
          useValue: mockRepository,
        },
        {
          provide: FiscoBcosAdapter,
          useValue: mockFiscoBcosAdapter,
        },
      ],
    }).compile();

    service = module.get<BlockchainService>(BlockchainService);
    repository = module.get<Repository<BlockchainAttestation>>(
      getRepositoryToken(BlockchainAttestation),
    );
    fiscoBcosAdapter = module.get<FiscoBcosAdapter>(FiscoBcosAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAttestation', () => {
    it('should create a blockchain attestation', async () => {
      const tenantId = 1;
      const dto = {
        attestation_type: 'prescription' as const,
        data_id: 'prescription-123',
        data: 'prescription data',
        metadata: { patient_id: 'P001' },
      };

      const dataHash = 'computed-sm3-hash';
      mockFiscoBcosAdapter.computeSM3Hash.mockReturnValue(dataHash);
      mockRepository.findOne.mockResolvedValue(null); // No duplicate

      const mockAttestation = {
        id: 1,
        tenantId,
        attestationType: dto.attestation_type,
        dataHash,
        status: AttestationStatus.PENDING,
        createdAt: new Date(),
      };

      mockRepository.create.mockReturnValue(mockAttestation);
      mockRepository.save.mockResolvedValue(mockAttestation);

      const result = await service.createAttestation(tenantId, dto);

      expect(mockFiscoBcosAdapter.computeSM3Hash).toHaveBeenCalledWith(dto.data);
      expect(mockRepository.create).toHaveBeenCalled();
      expect(result.data_hash).toBe(dataHash);
      expect(result.status).toBe(AttestationStatus.PENDING);
    });

    it('should reject duplicate attestation', async () => {
      const tenantId = 1;
      const dto = {
        attestation_type: 'prescription' as const,
        data: 'prescription data',
      };

      const dataHash = 'computed-sm3-hash';
      mockFiscoBcosAdapter.computeSM3Hash.mockReturnValue(dataHash);

      const existingAttestation = {
        id: 1,
        dataHash,
        tenantId,
      };
      mockRepository.findOne.mockResolvedValue(existingAttestation);

      await expect(service.createAttestation(tenantId, dto)).rejects.toThrow(
        'Data already attested',
      );
    });
  });

  describe('verifyAttestation', () => {
    it('should verify valid attestation', async () => {
      const tenantId = 1;
      const dto = {
        data: 'prescription data',
        attestation_id: 1,
      };

      const dataHash = 'computed-sm3-hash';
      mockFiscoBcosAdapter.computeSM3Hash.mockReturnValue(dataHash);

      const mockAttestation = {
        id: 1,
        dataHash,
        status: AttestationStatus.CONFIRMED,
      };
      mockRepository.findOne.mockResolvedValue(mockAttestation);

      mockFiscoBcosAdapter.verifyAttestation.mockResolvedValue({
        valid: true,
        attestation: { data_hash: dataHash, timestamp: Date.now(), signer: '0xabc' },
      });

      const result = await service.verifyAttestation(tenantId, dto);

      expect(result.valid).toBe(true);
      expect(result.attestation).toBeDefined();
    });

    it('should detect tampered data', async () => {
      const tenantId = 1;
      const dto = {
        data: 'tampered data',
        attestation_id: 1,
      };

      const dataHash = 'different-hash';
      mockFiscoBcosAdapter.computeSM3Hash.mockReturnValue(dataHash);

      const mockAttestation = {
        id: 1,
        dataHash: 'original-hash',
      };
      mockRepository.findOne.mockResolvedValue(mockAttestation);

      const result = await service.verifyAttestation(tenantId, dto);

      expect(result.valid).toBe(false);
      expect(result.message).toContain('tampered');
    });
  });
});
