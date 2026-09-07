export {
  CKD_SCENARIO,
  SPACE_ID,
  CKD_PURPOSE,
  CONNECTORS,
  SPACE_TASKS,
  ATTESTATIONS,
  SETTLEMENT_RECORDS,
  SECRETFLOW_SPEC,
  SECRETFLOW_SPEC_YAML,
  ASSISTANT_PLACEHOLDER,
  PARTY_MODALITY_MAP,
  coreSecretFlowSpec,
  computeSpaceStats,
  secretFlowSpecToYaml,
} from './ckd-federated-finetune';
export type {
  Connector,
  ConnectorRole,
  ConnectorStatus,
  TaskStatus,
  WorkloadType,
  TaskNodeRun,
  UsagePolicy,
  SpaceTask,
  Attestation,
  CatalogProductSeed,
  SettlementRecord,
  SecretFlowTaskSpecExport,
} from './ckd-federated-finetune';

export { AMR_PURPOSE, AMR_CATALOG_PRODUCTS } from './amr-products';

import { CATALOG_PRODUCTS as CKD_CATALOG_PRODUCTS } from './ckd-federated-finetune';
import { AMR_CATALOG_PRODUCTS } from './amr-products';

/** Control-plane catalog seed = CKD demos + AMR synthetic AST products. */
export const CATALOG_PRODUCTS = [...CKD_CATALOG_PRODUCTS, ...AMR_CATALOG_PRODUCTS];
