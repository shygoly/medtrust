import type { CatalogProductSeed } from './ckd-federated-finetune';

/**
 * 疫苗真实世界保护效果（检测阴性设计 TND）的演示参与方与数据产品（change `vaccine-effectiveness-tnd` tasks 3.3）。
 *
 * 两方角色不同、数据不重叠：疾控持有**接种记录**（谁、何时、哪一剂），医院持有**病原检测结果**（谁、何时、检出什么）。
 * 节点内按 `linkKey` 对齐后做层内 2×2（接种/未接种 × 阳性/阴性）；任一方单独拿不到这个表。
 * 行字段与封存投影的读法一致（`apps/connector/src/mdop/operators/seal.ts` 的 `veRegistryProjection` / `veTestProjection`）。
 */
export const VE_TND_PURPOSE = '疫苗真实世界保护效果（检测阴性设计）';

/** 疾控侧：一份接种记录（一行一剂）。 */
const veImmunizationFields = [
  { name: 'subjectKey', type: 'string', description: '受试者键（本地脱敏，出域前换 linkKey）' },
  { name: 'linkKey', type: 'string', description: '跨机构关联假名（对齐键）' },
  { name: 'ageBand', type: 'string', description: '年龄带（分层用）' },
  { name: 'sex', type: 'string', description: '性别（分层用）' },
  { name: 'immunizations', type: 'array', description: '接种事件 [{ code: 疫苗编码, date: 接种日 }]' },
];

/** 医院侧：一份病原检测结果（一次检测一行）。 */
const veTestFields = [
  { name: 'subjectKey', type: 'string', description: '受试者键（本地脱敏，出域前换 linkKey）' },
  { name: 'linkKey', type: 'string', description: '跨机构关联假名（对齐键）' },
  { name: 'ageBand', type: 'string', description: '年龄带（分层用）' },
  { name: 'sex', type: 'string', description: '性别（分层用）' },
  { name: 'datedEvents', type: 'array', description: '检测事件 [{ code: 病原编码, date: 采样日, result: pos|neg }]' },
];

export const VE_TND_CATALOG_PRODUCTS: CatalogProductSeed[] = [
  {
    id: 'dp-ve-tnd-immunization-cdc',
    providerId: 'p-cdc-demo',
    title: '疫苗接种记录（合成 疾控示范）',
    classification: '二级 重要数据',
    rightsConfirmed: true,
    recordCount: 20000,
    modality: 'structured_ehr',
    fhirSchema: {
      resourceType: 'Bundle',
      profile: 'urn:medtrust:ve-tnd-immunization-v1',
      dataPath: 'data/synthetic/ve-tnd/connectors/cdc',
      localDataPath: 'data/synthetic/ve-tnd/connectors/cdc',
      fields: veImmunizationFields,
    },
  },
  {
    id: 'dp-ve-tnd-tests-demohospa',
    providerId: 'p-demohospa',
    title: '病原检测结果（合成 示范甲）',
    classification: '二级 重要数据',
    rightsConfirmed: true,
    recordCount: 12000,
    modality: 'structured_ehr',
    fhirSchema: {
      resourceType: 'Bundle',
      profile: 'urn:medtrust:ve-tnd-tests-v1',
      dataPath: 'data/synthetic/ve-tnd/connectors/demohospa',
      localDataPath: 'data/synthetic/ve-tnd/connectors/demohospa',
      fields: veTestFields,
    },
  },
];
