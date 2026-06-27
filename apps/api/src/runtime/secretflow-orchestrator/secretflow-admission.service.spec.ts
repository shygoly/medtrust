import { ForbiddenException } from '@nestjs/common';
import { CKD_PURPOSE, coreSecretFlowSpec } from '@medtrust/demo-scenario';
import { SecretFlowAdmissionService } from './secretflow-admission.service';
import { ContractService } from '../digital-contract/contract.service';
import { SecretFlowTaskSpec } from '../../compute-task/dto/secretflow-task-spec';
import { DigitalContract } from '@medtrust/database';

const SPEC: SecretFlowTaskSpec = {
  ...(coreSecretFlowSpec() as SecretFlowTaskSpec),
  privacy: { teeRequired: false, heuEnabled: true },
  outputPolicy: { allowedArtifacts: ['lora_delta_hash'] },
};

function contract(over: Partial<DigitalContract>): DigitalContract {
  return {
    id: over.id ?? 'c1',
    dataProductId: 'dp-ckd-ehr',
    providerId: 'hospital-huashan',
    consumerId: 'pharma-hengrui',
    purpose: CKD_PURPOSE,
    retention: 'burn-after-read',
    output: 'aggregate',
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    status: 'active',
    hash: 'SM3:' + (over.id ?? 'c1'),
    ...over,
  } as DigitalContract;
}

function makeContracts(list: DigitalContract[]): ContractService {
  return {
    get: (id: string) => list.find((c) => c.id === id),
    effectiveStatus: (c: DigitalContract) =>
      new Date(c.validUntil).getTime() < Date.now() ? 'expired' : c.status,
  } as unknown as ContractService;
}

describe('SecretFlowAdmissionService', () => {
  it('admits when every provider has an active matching contract', async () => {
    const svc = new SecretFlowAdmissionService(
      makeContracts([
        contract({ id: 'c1', providerId: 'hospital-huashan' }),
        contract({ id: 'c2', providerId: 'hospital-ruijin' }),
        contract({ id: 'c3', providerId: 'hospital-zhongshan' }),
      ]),
    );
    const admitted = await svc.admit(SPEC, { contractIds: ['c1', 'c2', 'c3'] });
    expect(admitted.consumerId).toBe('pharma-hengrui');
    expect(admitted.contractHashes).toEqual(['SM3:c1', 'SM3:c2', 'SM3:c3']);
  });

  it('rejects when a provider has no contract', async () => {
    const svc = new SecretFlowAdmissionService(
      makeContracts([contract({ id: 'c1', providerId: 'hospital-huashan' })]),
    );
    await expect(svc.admit(SPEC, { contractIds: ['c1'] })).rejects.toThrow(ForbiddenException);
  });

  it('rejects an expired contract', async () => {
    const svc = new SecretFlowAdmissionService(
      makeContracts([
        contract({ id: 'c1', providerId: 'hospital-huashan', validUntil: new Date(Date.now() - 1000).toISOString() }),
        contract({ id: 'c2', providerId: 'hospital-ruijin' }),
        contract({ id: 'c3', providerId: 'hospital-zhongshan' }),
      ]),
    );
    await expect(svc.admit(SPEC, { contractIds: ['c1', 'c2', 'c3'] })).rejects.toThrow(/hospital-huashan/);
  });

  it('rejects a revoked contract', async () => {
    const svc = new SecretFlowAdmissionService(
      makeContracts([
        contract({ id: 'c1', providerId: 'hospital-huashan', status: 'revoked' }),
        contract({ id: 'c2', providerId: 'hospital-ruijin' }),
        contract({ id: 'c3', providerId: 'hospital-zhongshan' }),
      ]),
    );
    await expect(svc.admit(SPEC, { contractIds: ['c1', 'c2', 'c3'] })).rejects.toThrow(ForbiddenException);
  });

  it('rejects on consumer mismatch', async () => {
    const svc = new SecretFlowAdmissionService(
      makeContracts([
        contract({ id: 'c1', providerId: 'hospital-huashan', consumerId: 'other' }),
        contract({ id: 'c2', providerId: 'hospital-ruijin' }),
        contract({ id: 'c3', providerId: 'hospital-zhongshan' }),
      ]),
    );
    await expect(svc.admit(SPEC, { contractIds: ['c1', 'c2', 'c3'] })).rejects.toThrow(ForbiddenException);
  });

  it('enforces purpose when provided', async () => {
    const svc = new SecretFlowAdmissionService(
      makeContracts([
        contract({ id: 'c1', providerId: 'hospital-huashan', purpose: CKD_PURPOSE }),
        contract({ id: 'c2', providerId: 'hospital-ruijin', purpose: CKD_PURPOSE }),
        contract({ id: 'c3', providerId: 'hospital-zhongshan', purpose: CKD_PURPOSE }),
      ]),
    );
    await expect(svc.admit(SPEC, { contractIds: ['c1', 'c2', 'c3'], purpose: 'cardio' })).rejects.toThrow(
      ForbiddenException,
    );
    await expect(svc.admit(SPEC, { contractIds: ['c1', 'c2', 'c3'], purpose: CKD_PURPOSE })).resolves.toBeDefined();
  });

  it('rejects with no contracts at all (fail-closed)', async () => {
    const svc = new SecretFlowAdmissionService(makeContracts([]));
    await expect(svc.admit(SPEC, {})).rejects.toThrow(ForbiddenException);
  });
});
