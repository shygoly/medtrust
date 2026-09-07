import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { DataProduct, Favorite } from "@medtrust/database";

// P1-11:我的收藏。收藏存默认库(与 users 同库),产品标题/状态从
// control-plane 目录按 productId 补全(跨库松散关联,无 FK)。
@Injectable()
export class AccountService {
  constructor(
    @InjectRepository(Favorite)
    private readonly favorites: Repository<Favorite>,
    @InjectRepository(DataProduct, "controlplane")
    private readonly products: Repository<DataProduct>,
  ) {}

  async listFavorites(userId: number) {
    const rows = await this.favorites.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
    const products = await this.products.findByIds(
      rows.map((r) => r.dataProductId),
    );
    const byId = new Map(products.map((p) => [p.id, p]));
    return {
      items: rows.map((r) => {
        const p = byId.get(r.dataProductId);
        return {
          id: r.id,
          productId: r.dataProductId,
          createdAt: r.createdAt,
          product: p
            ? {
                id: p.id,
                urn: p.urn,
                title: p.title,
                providerId: p.providerId,
                productType: p.productType,
                status: p.status,
              }
            : null,
        };
      }),
      total: rows.length,
    };
  }

  async addFavorite(userId: number, productId: string) {
    const product = await this.products.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException("数据产品不存在");
    const existing = await this.favorites.findOne({
      where: { userId, dataProductId: productId },
    });
    if (existing) return { ok: true, duplicate: true };
    await this.favorites.save(
      this.favorites.create({ userId, dataProductId: productId }),
    );
    return { ok: true, duplicate: false };
  }

  async removeFavorite(userId: number, productId: string) {
    await this.favorites.delete({ userId, dataProductId: productId });
    return { ok: true };
  }
}
