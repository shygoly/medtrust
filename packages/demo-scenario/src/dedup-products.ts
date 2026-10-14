import type { CatalogProductSeed } from './ckd-federated-finetune';

/**
 * 跨院去重发病率与罕见病登记的演示参与方与数据产品（change `cross-hospital-dedup-incidence` tasks 3.3）。
 *
 * 至少两家医院各持一份院内队列切片：同一患者可能在多院留下记录，直接相加会重复计数
 * （发病率分子分母同时膨胀、罕见病把 1 例写成 2 例），所以去重必须在节点内按全局视图做。
 * 行字段与 `dedupCohortProjection` 的读法一致（观察期、事件、罕见病三块）。
 */
export const DEDUP_PURPOSE = '跨院去重的发病率与罕见病登记';

const dedupCohortFields = [
  { name: 'subjectKey', type: 'string', description: '受试者键（本地脱敏，出域前换 linkKey）' },
  { name: 'linkKey', type: 'string', description: '跨机构关联假名（对齐键）' },
  { name: 'ageBand', type: 'string', description: '年龄带（分层用）' },
  { name: 'sex', type: 'string', description: '性别（分层用）' },
  { name: 'observation', type: 'object', description: '观察期 { start, end }（闭区间）' },
  { name: 'events', type: 'array', description: '事件 [{ code: 诊断编码, date }]（白名单外不出域）' },
  { name: 'rareDisease', type: 'object', description: '罕见病 { code, firstDate } 或 null' },
];

export const DEDUP_CATALOG_PRODUCTS: CatalogProductSeed[] = [
  {
    id: 'dp-dedup-cohort-demohospa',
    providerId: 'p-demohospa',
    title: '院内队列切片（合成 示范甲）',
    classification: '二级 重要数据',
    rightsConfirmed: true,
    recordCount: 8000,
    modality: 'structured_ehr',
    fhirSchema: {
      resourceType: 'Bundle',
      profile: 'urn:medtrust:dedup-cohort-v1',
      dataPath: 'data/synthetic/dedup/connectors/demohospa',
      localDataPath: 'data/synthetic/dedup/connectors/demohospa',
      fields: dedupCohortFields,
    },
  },
  {
    id: 'dp-dedup-cohort-demohospb',
    providerId: 'p-demohospb',
    title: '院内队列切片（合成 示范乙）',
    classification: '二级 重要数据',
    rightsConfirmed: true,
    recordCount: 7600,
    modality: 'structured_ehr',
    fhirSchema: {
      resourceType: 'Bundle',
      profile: 'urn:medtrust:dedup-cohort-v1',
      dataPath: 'data/synthetic/dedup/connectors/demohospb',
      localDataPath: 'data/synthetic/dedup/connectors/demohospb',
      fields: dedupCohortFields,
    },
  },
];
