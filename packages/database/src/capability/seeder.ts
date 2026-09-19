import { DataSource, ObjectLiteral } from 'typeorm';
import { TAXONOMY } from './seed-data/taxonomy';
import { LANDING } from './seed-data/landing';
import { PLATFORM_OBJECTS } from './seed-data/platform-objects';
import { toKey } from './seed-data/key-util';
import {
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
  L2Guardrail, L2RiskPolicy, L2AnonymizationDegree, L2SecurityCapability,
  L2BlockRule, L2ApprovalRule, LayerKind,
} from './index';

// 转写完整性基准(对齐源《分类学-JSON》)。计数不符即抛错——这是 P0 的"测试"。
export const EXPECTED_COUNTS = {
  scenarios: 10, guardrails: 4, riskPolicies: 3, anonymizationDegrees: 2,
  securityCapabilities: 3, models: 12, algorithms: 11, operators: 20,
  protocols: 16, infrastructure: 14, blockRules: 6, approvalRules: 3,
} as const;

export interface DanglingRef {
  ctx: string; // 如 "scenario real-world-study-rws.model"
  ref: string; // 源显示名
}
export interface SeedReport {
  inserted: Record<string, number>;
  refs: { total: number; resolved: number; dangling: DanglingRef[] };
  // 落地状态叠加层: listed = 叠加层条目数, applied = 本库存在并已写入的条目数
  landing: { listed: number; applied: number };
}

function assertCounts(): void {
  const t = TAXONOMY;
  const actual = {
    scenarios: t.scenarios.length, guardrails: t.guardrails.length,
    riskPolicies: t.riskPolicies.length, anonymizationDegrees: t.anonymizationDegrees.length,
    securityCapabilities: t.securityCapabilities.length, models: t.models.length,
    algorithms: t.algorithms.length, operators: t.operators.length,
    protocols: t.protocols.length, infrastructure: t.infrastructure.length,
    blockRules: t.blockRules.length, approvalRules: t.approvalRules.length,
  };
  const errs: string[] = [];
  for (const [k, exp] of Object.entries(EXPECTED_COUNTS)) {
    const got = (actual as Record<string, number>)[k];
    if (got !== exp) errs.push(`${k}: 期望 ${exp}, 实际 ${got}`);
  }
  if (errs.length) throw new Error(`TAXONOMY 转写计数不符:\n- ${errs.join('\n- ')}`);
}

// 一层的解析索引: 既匹配 canonical key,也匹配 toKey(name)(容忍源用显示名)。
function indexOf(rows: { key: string; name?: string }[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    s.add(r.key);
    if (r.name) s.add(toKey(r.name));
  }
  return s;
}

// warn-only: 报告精确跨层引用是否解析。粗粒度的 operator.supportedProtocols
// (家族/伪协议如 'TEE'/'明文+DP'/'本地预处理')按设计不纳入报告。
function buildReport(inserted: Record<string, number>): Omit<SeedReport, 'landing'> {
  const t = TAXONOMY;
  const models = indexOf(t.models), algos = indexOf(t.algorithms),
        ops = indexOf(t.operators), protos = indexOf(t.protocols),
        anon = indexOf(t.anonymizationDegrees),
        sec = indexOf(t.securityCapabilities);
  const dangling: DanglingRef[] = [];
  let total = 0, resolved = 0;
  const check = (refs: string[] | undefined, pool: Set<string>, ctx: string) => {
    for (const r of refs ?? []) {
      total++;
      if (pool.has(toKey(r)) || pool.has(r)) resolved++;
      else dangling.push({ ctx, ref: r });
    }
  };
  for (const s of t.scenarios) {
    check(s.typicalModelKeys, models, `scenario ${s.key}.model`);
    check(s.typicalAlgorithmKeys, algos, `scenario ${s.key}.algo`);
  }
  for (const m of t.models) check(m.trainingAlgorithmKeys, algos, `model ${m.key}.algo`);
  for (const a of t.algorithms) check(a.underlyingOperatorKeys, ops, `algo ${a.key}.op`);
  for (const g of t.guardrails) {
    check(g.requiredOperatorKeys, ops, `guardrail ${g.key}.op`);
    check(g.requiredAlgorithmKeys, algos, `guardrail ${g.key}.algo`);
  }
  for (const rp of t.riskPolicies) {
    check(rp.requiredAlgorithmKeys, algos, `risk ${rp.key}.algo`);
    check([rp.requiredAnonymizationKey], anon, `risk ${rp.key}.anon`);
    check([rp.requiredSecurityCapabilityKey], sec, `risk ${rp.key}.sec`);
  }
  for (const sc of t.securityCapabilities) check(sc.requiredProtocolKeys, protos, `sec ${sc.key}.proto`);
  return { inserted, refs: { total, resolved, dangling } };
}

async function upsert(
  ds: DataSource, Entity: new () => ObjectLiteral, rows: ObjectLiteral[], keyField = 'key',
): Promise<number> {
  const repo = ds.getRepository(Entity);
  for (const row of rows) {
    const existing = await repo.findOne({ where: { [keyField]: row[keyField] } as any });
    await repo.save(existing ? repo.merge(existing, row) : repo.create(row));
  }
  return repo.count();
}

const LAYER_ENTITY: Partial<Record<LayerKind, new () => ObjectLiteral>> = {
  [LayerKind.L1_SCENARIO]: L1Scenario,
  [LayerKind.L3_MODEL]: L3Model,
  [LayerKind.L4_ALGORITHM]: L4Algorithm,
  [LayerKind.L5_OPERATOR]: L5Operator,
  [LayerKind.L6_PROTOCOL]: L6Protocol,
  [LayerKind.L7_INFRASTRUCTURE]: L7Infrastructure,
};

// 落地状态叠加层 → status(active 已落地 / draft 未落地)+ metadata.impl。
// 只写叠加层列出的 key;本库不存在的 key 跳过,未列出的对象不动(运营方在图谱后台维护)。
async function applyLanding(ds: DataSource): Promise<SeedReport['landing']> {
  let listed = 0, applied = 0;
  for (const [layer, entries] of Object.entries(LANDING) as [LayerKind, typeof LANDING[LayerKind]][]) {
    const repo = ds.getRepository(LAYER_ENTITY[layer]!);
    for (const [key, l] of Object.entries(entries ?? {})) {
      listed++;
      const row = await repo.findOne({ where: { key } });
      if (!row) continue;
      row.status = l.landed ? 'active' : 'draft';
      // metadata.analysisTypes：能力对象支撑的分析类型（合规预审任务准入范围检查依据，D-CMP-2）
      row.metadata = {
        ...(row.metadata ?? {}),
        impl: l.impl,
        ...(l.analysisTypes ? { analysisTypes: l.analysisTypes } : {}),
      };
      await repo.save(row);
      applied++;
    }
  }
  return { listed, applied };
}

// 幂等: 按 key upsert。不在悬空引用上 fail-closed(选项1);严格校验推迟到 P1。
export async function seedCapability(ds: DataSource): Promise<SeedReport> {
  assertCounts();
  const t = TAXONOMY;
  const inserted: Record<string, number> = {};
  inserted.l1_scenario = await upsert(ds, L1Scenario, t.scenarios);
  inserted.l3_model = await upsert(ds, L3Model, t.models);
  inserted.l4_algorithm = await upsert(ds, L4Algorithm, t.algorithms);
  inserted.l5_operator = await upsert(ds, L5Operator, t.operators);
  inserted.l6_protocol = await upsert(ds, L6Protocol, t.protocols);
  inserted.l7_infrastructure = await upsert(ds, L7Infrastructure, t.infrastructure);
  inserted.l2_guardrail = await upsert(ds, L2Guardrail, t.guardrails);
  inserted.l2_risk_policy = await upsert(ds, L2RiskPolicy, t.riskPolicies);
  inserted.l2_anonymization_degree = await upsert(ds, L2AnonymizationDegree, t.anonymizationDegrees);
  inserted.l2_security_capability = await upsert(ds, L2SecurityCapability, t.securityCapabilities);
  inserted.l2_block_rule = await upsert(ds, L2BlockRule, t.blockRules);
  inserted.l2_approval_rule = await upsert(ds, L2ApprovalRule, t.approvalRules, 'conditionGroup');
  // 平台自有对象(不在行业分类学里),须在叠加层之前入库
  inserted.l3_model = await upsert(ds, L3Model, PLATFORM_OBJECTS.models);
  inserted.l4_algorithm = await upsert(ds, L4Algorithm, PLATFORM_OBJECTS.algorithms);
  // D-CMP-1：代表 federated 保障级的已落地 L6 对象（平台自有，落地状态见 landing.ts）
  inserted.l6_protocol = await upsert(ds, L6Protocol, PLATFORM_OBJECTS.protocols);
  const landing = await applyLanding(ds);
  return { ...buildReport(inserted), landing };
}
