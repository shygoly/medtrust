import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SpaceEntity } from "@medtrust/database";
import { SPACE_ID } from "@medtrust/demo-scenario";

// 空间基础管理(对齐《技术架构》"空间管理" + space-management spec, TC609 P0-1)。
// 空间是可信数据空间的顶层容器;目录/合约通过 homeSpace/spaceId 引用真实空间 id。
// 持久化在 control-plane 库。SPACE_ID 不再只是 demo-scenario 常量——它同时是
// 默认空间记录的 id(seed 兼容),使已有数据(homeSpace="sh-med")与空间记录一致。
export interface SpaceInput {
  id: string;
  name: string;
  description?: string;
}

@Injectable()
export class SpaceService implements OnModuleInit {
  constructor(
    @InjectRepository(SpaceEntity, "controlplane")
    private readonly repo: Repository<SpaceEntity>,
  ) {}

  // 幂等种子:默认空间(id 与 demo-scenario SPACE_ID 一致)。缺失则插入,已有则不动。
  async onModuleInit(): Promise<void> {
    const existing = await this.repo.findOne({ where: { id: SPACE_ID } });
    if (!existing) {
      await this.repo.save(
        this.repo.create({
          id: SPACE_ID,
          name: "上海医疗可信数据空间",
          description: "默认空间(seed,与 demo-scenario SPACE_ID 对齐)",
          status: "active",
        }),
      );
    }
  }

  async create(input: SpaceInput): Promise<SpaceEntity> {
    if (!input.id || !input.id.trim())
      throw new BadRequestException("空间 id 不可为空");
    const existing = await this.repo.findOne({ where: { id: input.id } });
    if (existing) throw new ConflictException("空间已存在");
    return this.repo.save(
      this.repo.create({
        id: input.id,
        name: input.name,
        description: input.description,
        status: "active",
      }),
    );
  }

  list(): Promise<SpaceEntity[]> {
    return this.repo.find();
  }

  get(id: string): Promise<SpaceEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException("空间不存在");
    await this.repo.delete({ id });
  }
}
