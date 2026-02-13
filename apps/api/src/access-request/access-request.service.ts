import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';
import { UpdateAccessRequestDto } from './dto/update-access-request.dto';
import { AccessRequestStatus } from '@medtrust/database';

@Injectable()
export class AccessRequestService {
  private readonly accessRequests: Map<number, any> = new Map();
  private nextId = 1;

  async create(requesterTenantId: number, createDto: CreateAccessRequestDto) {
    const request = {
      id: this.nextId++,
      requesterTenantId,
      ...createDto,
      status: AccessRequestStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.accessRequests.set(request.id, request);
    return request;
  }

  async findAll(tenantId?: number, type?: 'requester' | 'provider') {
    const requests = Array.from(this.accessRequests.values());
    
    if (tenantId && type === 'requester') {
      return requests.filter(r => r.requesterTenantId === tenantId);
    }
    
    if (tenantId && type === 'provider') {
      return requests.filter(r => r.providerTenantId === tenantId);
    }
    
    return requests;
  }

  async findOne(id: number) {
    const request = this.accessRequests.get(id);
    if (!request) {
      throw new NotFoundException(`AccessRequest with ID ${id} not found`);
    }
    return request;
  }

  async update(id: number, updateDto: UpdateAccessRequestDto) {
    const request = await this.findOne(id);
    const updated = {
      ...request,
      ...updateDto,
      updatedAt: new Date(),
    };
    this.accessRequests.set(id, updated);
    return updated;
  }

  async approve(id: number, approvedBy: number) {
    const request = await this.findOne(id);
    request.status = AccessRequestStatus.APPROVED;
    request.approvedBy = approvedBy;
    request.approvedAt = new Date();
    request.updatedAt = new Date();
    return request;
  }

  async reject(id: number, rejectionReason: string) {
    const request = await this.findOne(id);
    request.status = AccessRequestStatus.REJECTED;
    request.rejectionReason = rejectionReason;
    request.updatedAt = new Date();
    return request;
  }

  async complete(id: number, actualCost: number) {
    const request = await this.findOne(id);
    request.status = AccessRequestStatus.COMPLETED;
    request.actualCost = actualCost;
    request.actualEndAt = new Date();
    request.updatedAt = new Date();
    return request;
  }

  async remove(id: number) {
    const request = await this.findOne(id);
    this.accessRequests.delete(id);
    return { deleted: true, id };
  }
}
