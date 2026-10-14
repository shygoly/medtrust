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
export { VE_TND_PURPOSE, VE_TND_CATALOG_PRODUCTS } from './ve-tnd-products';
export { DEDUP_PURPOSE, DEDUP_CATALOG_PRODUCTS } from './dedup-products';

import { CATALOG_PRODUCTS as CKD_CATALOG_PRODUCTS } from './ckd-federated-finetune';
import { AMR_CATALOG_PRODUCTS } from './amr-products';
import { VE_TND_CATALOG_PRODUCTS } from './ve-tnd-products';
import { DEDUP_CATALOG_PRODUCTS } from './dedup-products';

/**
 * Control-plane catalog seed = CKD demos + AMR synthetic AST products
 * + 疫苗保护效果（TND）与跨院去重两个场景的参与方/数据产品（各自变更的 tasks 3.3）。
 */
export const CATALOG_PRODUCTS = [
  ...CKD_CATALOG_PRODUCTS,
  ...AMR_CATALOG_PRODUCTS,
  ...VE_TND_CATALOG_PRODUCTS,
  ...DEDUP_CATALOG_PRODUCTS,
];
