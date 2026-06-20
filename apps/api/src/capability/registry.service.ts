import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ObjectLiteral } from 'typeorm';
import {
  LayerKind,
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
} from '@medtrust/database';

// P0 只读: 6 能力层(L1、L3-L7)。L2 规则表读取在 P1 随 ComplianceEngine 提供。
@Injectable()
export class CapabilityRegistryService {
  private readonly repos: Partial<Record<LayerKind, Repository<ObjectLiteral>>>;

  constructor(
    @InjectRepository(L1Scenario) l1: Repository<L1Scenario>,
    @InjectRepository(L3Model) l3: Repository<L3Model>,
    @InjectRepository(L4Algorithm) l4: Repository<L4Algorithm>,
    @InjectRepository(L5Operator) l5: Repository<L5Operator>,
    @InjectRepository(L6Protocol) l6: Repository<L6Protocol>,
    @InjectRepository(L7Infrastructure) l7: Repository<L7Infrastructure>,
  ) {
    this.repos = {
      [LayerKind.L1_SCENARIO]: l1,
      [LayerKind.L3_MODEL]: l3,
      [LayerKind.L4_ALGORITHM]: l4,
      [LayerKind.L5_OPERATOR]: l5,
      [LayerKind.L6_PROTOCOL]: l6,
      [LayerKind.L7_INFRASTRUCTURE]: l7,
    };
  }

  private repo(layer: LayerKind): Repository<ObjectLiteral> {
    const r = this.repos[layer];
    if (!r) throw new BadRequestException(`未知或不可读的层: ${layer}`);
    return r;
  }

  list(layer: LayerKind): Promise<ObjectLiteral[]> {
    return this.repo(layer).find();
  }

  get(layer: LayerKind, key: string): Promise<ObjectLiteral | null> {
    return this.repo(layer).findOne({ where: { key } });
  }
}
