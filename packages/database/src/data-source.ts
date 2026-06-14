import { DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { ComputeTask } from './entities/compute-task.entity';
import { AuditLog } from './entities/audit-log.entity';

export const AppDataSource = new DataSource({
  type: 'better-sqlite3',
  database: process.env.DATABASE_URL || './data/medtrust.db',
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
  entities: [
    Tenant,
    User,
    ComputeTask,
    AuditLog,
  ],
  migrations: ['./migrations/*.ts'],
  subscribers: [],
});
