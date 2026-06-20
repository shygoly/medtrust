import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ObjectLiteral } from 'typeorm';
import {
  LayerKind,
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
} from '@medtrust/database';

// 各能力层创建时必填的层内字段(key/name 始终必填,见下)。
const REQUIRED_FIELDS: Partial<Record<LayerKind, string[]>> = {
  [LayerKind.L1_SCENARIO]: ['riskLevel'],
  [LayerKind.L3_MODEL]: ['category'],
  [LayerKind.L4_ALGORITHM]: ['category'],
  [LayerKind.L5_OPERATOR]: ['opType'],
  [LayerKind.L6_PROTOCOL]: ['family', 'securityAssumption', 'securityCapabilityLevel'],
  [LayerKind.L7_INFRASTRUCTURE]: ['infraType', 'vendor'],
};

// P0 只读 + P4 写: 6 能力层(L1、L3-L7) 的系统对象 CRUD。L2 规则表只读(治理策略)。
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

  async create(layer: LayerKind, dto: Record<string, unknown>): Promise<ObjectLiteral> {
    const repo = this.repo(layer);
    const key = dto.key;
    if (typeof key !== 'string' || !key.trim()) {
      throw new BadRequestException('key 必填');
    }
    if (typeof dto.name !== 'string' || !dto.name.trim()) {
      throw new BadRequestException('name 必填');
    }
    for (const field of REQUIRED_FIELDS[layer] ?? []) {
      if (dto[field] === undefined || dto[field] === null || dto[field] === '') {
        throw new BadRequestException(`${layer} 创建缺少必填字段: ${field}`);
      }
    }
    const existing = await repo.findOne({ where: { key } });
    if (existing) throw new ConflictException(`${layer} 已存在 key=${key}`);
    return repo.save(repo.create(dto));
  }

  async update(layer: LayerKind, key: string, dto: Record<string, unknown>): Promise<ObjectLiteral> {
    const repo = this.repo(layer);
    const existing = await repo.findOne({ where: { key } });
    if (!existing) throw new NotFoundException(`${layer} 不存在 key=${key}`);
    // key 不可改(稳定标识,跨层引用依赖它)
    const { key: _ignored, ...patch } = dto;
    void _ignored;
    return repo.save(repo.merge(existing, patch));
  }

  async remove(layer: LayerKind, key: string): Promise<{ deleted: true; key: string }> {
    const repo = this.repo(layer);
    const existing = await repo.findOne({ where: { key } });
    if (!existing) throw new NotFoundException(`${layer} 不存在 key=${key}`);
    await repo.remove(existing);
    return { deleted: true, key };
  }
}
