import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { DigitalContract, ContractStatus } from '@medtrust/database';

export interface ContractRequest {
  dataProductId: string;
  providerId: string;
  consumerId: string;
  purpose: string;
  retention: string;
  output: string;
  validDays: number;
}

// 数字合约管理(digital-contract spec) + 使用控制策略生成(usage-control 4.1/4.2)。
// 数据提供方批准一次申请 → 生成生效的数字合约(含 SM3 哈希),供下发到连接器。
@Injectable()
export class ContractService {
  private readonly contracts = new Map<string, DigitalContract>();

  constructor(private readonly gm: GMCryptoService) {}

  approve(req: ContractRequest): DigitalContract {
    const validUntil = new Date(Date.now() + req.validDays * 86_400_000).toISOString();
    const base: Omit<DigitalContract, 'hash'> = {
      id: randomUUID(),
      dataProductId: req.dataProductId,
      providerId: req.providerId,
      consumerId: req.consumerId,
      purpose: req.purpose,
      retention: req.retention,
      output: req.output,
      validUntil,
      status: 'active',
    };
    const contract: DigitalContract = { ...base, hash: 'SM3:' + this.gm.sm3Hash(this.canonical(base)) };
    this.contracts.set(contract.id, contract);
    return contract;
  }

  // 生效状态(惰性计算过期)。PEP 与编排都应以此为准。
  effectiveStatus(contract: DigitalContract, now = Date.now()): ContractStatus {
    if (contract.status === 'revoked') return 'revoked';
    if (new Date(contract.validUntil).getTime() < now) return 'expired';
    return contract.status;
  }

  revoke(id: string): void {
    const c = this.contracts.get(id);
    if (c) c.status = 'revoked';
  }

  get(id: string): DigitalContract | undefined {
    return this.contracts.get(id);
  }

  // Lists contracts with their effective (lazily-computed) status.
  list(): (DigitalContract & { effectiveStatus: ContractStatus })[] {
    return [...this.contracts.values()].map((c) => ({ ...c, effectiveStatus: this.effectiveStatus(c) }));
  }

  private canonical(c: Omit<DigitalContract, 'hash'>): string {
    return JSON.stringify({
      dataProductId: c.dataProductId,
      providerId: c.providerId,
      consumerId: c.consumerId,
      purpose: c.purpose,
      retention: c.retention,
      output: c.output,
      validUntil: c.validUntil,
    });
  }
}
