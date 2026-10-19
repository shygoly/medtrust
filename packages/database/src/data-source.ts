import { DataSource, DataSourceOptions } from 'typeorm';
import { Tenant } from './entities/tenant.entity';
import { User } from './entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { ComputeTask } from './entities/compute-task.entity';
import { AuditLog } from './entities/audit-log.entity';
import { resolveDatabaseOptions } from './database-options';

const options: DataSourceOptions = resolveDatabaseOptions({
  variable: 'DATABASE_URL',
  url: process.env.DATABASE_URL || '',
  defaultPostgresUrl: 'postgres://medtrust:medtrust@127.0.0.1:5432/medtrust_api',
  entities: [
    Tenant,
    User,
    RefreshToken,
    ComputeTask,
    AuditLog,
  ],
  // This legacy connection predates the PostgreSQL cutover and its old
  // migrations contain non-timestamp class names rejected by TypeORM 0.3.
  // Its existing PostgreSQL schema is deployment-managed; the new explicit
  // migrations live under `migrations/control-plane` and
  // `migrations/connector` and are owned by those two named data sources.
  migrations: [],
});

export const AppDataSource = new DataSource(options);
