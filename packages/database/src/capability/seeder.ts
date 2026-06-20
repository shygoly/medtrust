import { DataSource, ObjectLiteral } from 'typeorm';
import { TAXONOMY } from './seed-data/taxonomy';
import { toKey } from './seed-data/key-util';
import {
  L1Scenario, L3Model, L4Algorithm, L5Operator, L6Protocol, L7Infrastructure,
  L2Guardrail, L2RiskPolicy, L2AnonymizationDegree, L2SecurityCapability,
  L2BlockRule, L2ApprovalRule,
} from './index';

// 转写完整性基准(对齐源《分类学-JSON》)。计数不符即抛错——这是 P0 的"测试"。
export const EXPECTED_COUNTS = {
  scenarios: 10, guardrails: 4, riskPolicies: 3, anonymizationDegrees: 2,
  securityCapabilities: 2, models: 12, algorithms: 11, operators: 20,
  protocols: 16, infrastructure: 14, blockRules: 5, approvalRules: 3,
} as const;

export interface DanglingRef {
  ctx: string; // 如 "scenario real-world-study-rws.model"
  ref: string; // 源显示名
}
export interface SeedReport {
  inserted: Record<string, number>;
  refs: { total: number; resolved: number; dangling: DanglingRef[] };
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
function buildReport(inserted: Record<string, number>): SeedReport {
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
  return buildReport(inserted);
}
