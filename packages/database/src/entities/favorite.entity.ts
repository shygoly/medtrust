import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// P1-11 我的收藏:用户收藏的数据产品(跨库关联 data_product 的 productId)。
// 存默认库(与 users 同库),仅存 productId,不冗余产品元数据。
@Entity('favorites')
@Index(['userId', 'dataProductId'], { unique: true })
export class Favorite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @Column({ name: 'data_product_id', length: 64 })
  dataProductId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
