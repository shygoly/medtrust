import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateDataAssetDto } from './dto/create-data-asset.dto';
import { UpdateDataAssetDto } from './dto/update-data-asset.dto';
import { DataAssetStatus } from '@medtrust/database';

@Injectable()
export class DataAssetService {
  private readonly dataAssets: Map<number, any> = new Map();
  private nextId = 1;

  async create(tenantId: number, createDataAssetDto: CreateDataAssetDto) {
    const dataAsset = {
      id: this.nextId++,
      tenantId,
      ...createDataAssetDto,
      status: DataAssetStatus.DRAFT,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.dataAssets.set(dataAsset.id, dataAsset);
    return dataAsset;
  }

  async findAll(tenantId?: number) {
    const assets = Array.from(this.dataAssets.values());
    if (tenantId) {
      return assets.filter(asset => asset.tenantId === tenantId);
    }
    return assets;
  }

  async findOne(id: number) {
    const asset = this.dataAssets.get(id);
    if (!asset) {
      throw new NotFoundException(`DataAsset with ID ${id} not found`);
    }
    return asset;
  }

  async update(id: number, updateDataAssetDto: UpdateDataAssetDto) {
    const asset = await this.findOne(id);
    const updated = {
      ...asset,
      ...updateDataAssetDto,
      updatedAt: new Date(),
    };
    this.dataAssets.set(id, updated);
    return updated;
  }

  async remove(id: number) {
    const asset = await this.findOne(id);
    this.dataAssets.delete(id);
    return { deleted: true, id };
  }

  async publish(id: number) {
    const asset = await this.findOne(id);
    asset.status = DataAssetStatus.PUBLISHED;
    asset.publishedAt = new Date();
    asset.updatedAt = new Date();
    return asset;
  }
}
