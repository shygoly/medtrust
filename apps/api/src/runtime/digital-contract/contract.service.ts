import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { DigitalContract, ContractStatus, DigitalContractEntity } from '@medtrust/database';

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
// 持久化在 control-plane 库。
@Injectable()
export class ContractService implements OnModuleInit {
  constructor(
    private readonly gm: GMCryptoService,
    @InjectRepository(DigitalContractEntity, 'controlplane')
    private readonly repo: Repository<DigitalContractEntity>,
  ) {}

  // 幂等演示种子(以 dataProductId+consumerId+purpose 去重),让控制台合约页非空。
  async onModuleInit(): Promise<void> {
    const demos: ContractRequest[] = [
      { dataProductId: 'dp-ckd-ehr', providerId: '华山医院', consumerId: '恒瑞医药', purpose: 'CKD 多中心疗效真实世界研究', retention: '阅后即焚', output: '仅聚合统计', validDays: 90 },
      { dataProductId: 'dp-ckd-imaging', providerId: '瑞金医院', consumerId: '医研数据研究院', purpose: '肾脏影像联合建模', retention: '30 天', output: '仅模型增量', validDays: 60 },
      { dataProductId: 'dp-ckd-lab', providerId: '华山医院', consumerId: '智慧医疗AI', purpose: '检验指标异常筛查模型训练', retention: '阅后即焚', output: '仅聚合统计', validDays: 30 },
    ];
    // 用确定性 id(自然键派生)走 save upsert(按主键),重复运行/并发都只一行。
    for (const d of demos) {
      await this.approve(d, `seed:${d.dataProductId}:${d.consumerId}`);
    }
  }

  async approve(req: ContractRequest, id: string = randomUUID()): Promise<DigitalContract> {
    const validUntil = new Date(Date.now() + req.validDays * 86_400_000).toISOString();
    const base: Omit<DigitalContract, 'hash'> = {
      id,
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
    await this.repo.save(this.repo.create(contract));
    return contract;
  }

  // 生效状态(惰性计算过期)。PEP 与编排都应以此为准。
  effectiveStatus(contract: DigitalContract, now = Date.now()): ContractStatus {
    if (contract.status === 'revoked') return 'revoked';
    if (new Date(contract.validUntil).getTime() < now) return 'expired';
    return contract.status;
  }

  async revoke(id: string): Promise<void> {
    await this.repo.update({ id }, { status: 'revoked' });
  }

  async get(id: string): Promise<DigitalContract | undefined> {
    return (await this.repo.findOne({ where: { id } })) ?? undefined;
  }

  // Lists contracts with their effective (lazily-computed) status.
  async list(): Promise<(DigitalContract & { effectiveStatus: ContractStatus })[]> {
    const all = await this.repo.find();
    return all.map((c) => ({ ...c, effectiveStatus: this.effectiveStatus(c) }));
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
