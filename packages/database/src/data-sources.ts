import { DataSource } from 'typeorm';
import { controlPlaneEntities } from './control-plane';
import { connectorEntities } from './connector';

// Control-plane metadata DB (catalog/identity/contract/attestation index).
// Small; SQLite is fine. NEVER holds raw medical data.
export const ControlPlaneDataSource = new DataSource({
  type: 'better-sqlite3',
  database: process.env.CONTROL_PLANE_DB_URL || './data/control-plane.db',
  synchronize: process.env.NODE_ENV !== 'production',
  enableWAL: true,
  migrationsRun: true,
  migrations: ['./migrations/control-plane/*.ts'],
  entities: controlPlaneEntities,
});

// Connector-local DB. Deployed on the participant's side; holds de-identified
// rows that physically never leave the connector. Each connector has its own.
export const ConnectorDataSource = new DataSource({
  type: 'better-sqlite3',
  database: process.env.CONNECTOR_DB_URL || './data/connector-local.db',
  synchronize: process.env.NODE_ENV !== 'production',
  enableWAL: true,
  migrationsRun: true,
  migrations: ['./migrations/connector/*.ts'],
  entities: connectorEntities,
});
