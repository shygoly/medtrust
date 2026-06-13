import { NotFoundException } from '@nestjs/common';
import { GMCryptoService } from '../security/crypto/gm-crypto.service';
import { ContractService } from './contract.service';
import { AttestationService } from './attestation.service';
import { ContractController } from './contract.controller';

const dto = {
  dataProductId: 'dp-1',
  providerId: 'h-huashan',
  consumerId: 'p-hengrui',
  purpose: '药物警戒',
  retention: '阅后即焚',
  output: '仅聚合',
  validDays: 90,
};

describe('ContractController — 数字合约端点', () => {
  let ctrl: ContractController;
  let contracts: ContractService;
  beforeEach(() => {
    const gm = new GMCryptoService();
    contracts = new ContractService(gm);
    ctrl = new ContractController(contracts, new AttestationService(gm));
  });

  it('approve → list → get round-trips an active contract', () => {
    const c = ctrl.approve(dto);
    expect(c.status).toBe('active');
    expect(ctrl.list()).toHaveLength(1);
    expect(ctrl.get(c.id).id).toBe(c.id);
  });

  it('revoke flips effective status to revoked', () => {
    const c = ctrl.approve(dto);
    ctrl.revoke(c.id);
    expect(contracts.effectiveStatus(contracts.get(c.id)!)).toBe('revoked');
  });

  it('attest returns an on-chain receipt with hash only', () => {
    const c = ctrl.approve(dto);
    const r = ctrl.attest(c.id);
    expect(r.txHash).toMatch(/^0x/);
    expect(JSON.stringify(r)).not.toContain('药物警戒');
  });

  it('get/revoke/attest on a missing id throw NotFound', () => {
    expect(() => ctrl.get('nope')).toThrow(NotFoundException);
    expect(() => ctrl.revoke('nope')).toThrow(NotFoundException);
    expect(() => ctrl.attest('nope')).toThrow(NotFoundException);
  });
});
