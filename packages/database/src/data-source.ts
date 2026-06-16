import { DataSource, DataSourceOptions } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { ComputeTask } from './entities/compute-task.entity';
import { AuditLog } from './entities/audit-log.entity';

const databaseUrl = process.env.DATABASE_URL || './data/medtrust.db';
const isPostgres = /^postgres(ql)?:\/\//.test(databaseUrl);

const common = {
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
};

const options: DataSourceOptions = isPostgres
  ? { type: 'postgres', url: databaseUrl, ...common }
  : { type: 'better-sqlite3', database: databaseUrl, ...common };

export const AppDataSource = new DataSource(options);
