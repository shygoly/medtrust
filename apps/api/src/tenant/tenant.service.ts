import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantStatus } from '@medtrust/database';

@Injectable()
export class TenantService {
  private readonly tenants: Map<number, any> = new Map();
  private nextId = 1;

  async create(createTenantDto: CreateTenantDto) {
    const tenant = {
      id: this.nextId++,
      ...createTenantDto,
      status: TenantStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async findAll() {
    return Array.from(this.tenants.values());
  }

  async findOne(id: number) {
    const tenant = this.tenants.get(id);
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }
    return tenant;
  }

  async update(id: number, updateTenantDto: UpdateTenantDto) {
    const tenant = await this.findOne(id);
    const updated = {
      ...tenant,
      ...updateTenantDto,
      updatedAt: new Date(),
    };
    this.tenants.set(id, updated);
    return updated;
  }

  async remove(id: number) {
    const tenant = await this.findOne(id);
    this.tenants.delete(id);
    return { deleted: true, id };
  }
}
