import type { CatalogProductSeed } from './ckd-federated-finetune';

/** AMR Sentinel synthetic AST products (示范甲 / 示范乙). */
export const AMR_PURPOSE = '抗菌药物耐药监测真实世界研究';

const amrFields = [
  { name: 'subjectKey', type: 'string', description: '受试者键（脱敏）' },
  { name: 'ageBand', type: 'string', description: '年龄带' },
  { name: 'sex', type: 'string', description: '性别' },
  { name: 'conditions', type: 'array', description: '含 organism: / resist:{org}:{abx}:{SIR}' },
  { name: 'medications', type: 'array', description: '经验治疗 ATC/WHONET 编码' },
  { name: 'adverseEvents', type: 'array', description: '30 天全因死亡等' },
  { name: 'followUpDays', type: 'integer', description: '随访天数' },
  { name: 'treated', type: 'boolean', description: '是否碳青霉烯经验治疗臂' },
  { name: 'eventOccurred', type: 'boolean', description: '是否发生目标结局' },
  { name: 'organism', type: 'string', description: 'WHONET 菌种码' },
  { name: 'specimenType', type: 'string', description: '标本类型' },
];

export const AMR_CATALOG_PRODUCTS: CatalogProductSeed[] = [
  {
    id: 'dp-amr-ast-demohospa',
    providerId: 'p-demohospa',
    title: '细菌药敏分离株（AMR 合成 · 示范甲）',
    classification: '二级 · 重要数据',
    rightsConfirmed: true,
    recordCount: 5000,
    modality: 'structured_ehr',
    fhirSchema: {
      resourceType: 'Bundle',
      profile: 'urn:medtrust:amr-ast-v1',
      dataPath: 'data/synthetic/amr/connectors/demohospa',
      localDataPath: 'data/synthetic/amr/connectors/demohospa',
      fields: amrFields,
    },
  },
  {
    id: 'dp-amr-ast-demohospb',
    providerId: 'p-demohospb',
    title: '细菌药敏分离株（AMR 合成 · 示范乙）',
    classification: '二级 · 重要数据',
    rightsConfirmed: true,
    recordCount: 5000,
    modality: 'structured_ehr',
    fhirSchema: {
      resourceType: 'Bundle',
      profile: 'urn:medtrust:amr-ast-v1',
      dataPath: 'data/synthetic/amr/connectors/demohospb',
      localDataPath: 'data/synthetic/amr/connectors/demohospb',
      fields: amrFields,
    },
  },
];
