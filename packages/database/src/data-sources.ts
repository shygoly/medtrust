import { DataSource } from 'typeorm';
import { controlPlaneEntities } from './control-plane';
import { connectorEntities } from './connector';
import { resolveDatabaseOptions } from './database-options';
import { join } from 'node:path';

// Control-plane metadata DB (catalog/identity/contract/attestation index).
// PostgreSQL is mandatory outside test. NEVER holds raw medical data.
export const ControlPlaneDataSource = new DataSource(resolveDatabaseOptions({
  variable: 'CONTROL_PLANE_DB_URL',
  url: process.env.CONTROL_PLANE_DB_URL || '',
  defaultPostgresUrl:
    'postgres://medtrust:medtrust@127.0.0.1:5432/medtrust_controlplane',
  migrations: [join(__dirname, 'migrations/control-plane/*{.ts,.js}')],
  entities: controlPlaneEntities,
}));

// Connector-local DB. Each connector MUST receive its own PostgreSQL database
// and credentials; connectors never share a database.
export const ConnectorDataSource = new DataSource(resolveDatabaseOptions({
  variable: 'CONNECTOR_DB_URL',
  url: process.env.CONNECTOR_DB_URL || '',
  defaultPostgresUrl:
    'postgres://medtrust:medtrust@127.0.0.1:5432/medtrust_connector',
  migrations: [join(__dirname, 'migrations/connector/*{.ts,.js}')],
  entities: connectorEntities,
}));
