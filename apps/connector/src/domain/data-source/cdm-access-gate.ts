// omop-data-source-access —— 接入一致性校验（task 3.x，spec: 接入一致性校验 fail-closed）。
//
// 数据源在被任何合约引用之前必须过这道闸。每一项失败都**归因到具体的权限域**，
// 医院 DBA 看到错误就知道改哪里（spec: 权限不足与契约不成立需可区分）：
//
//   role            账号属性：不得是超级用户 / 不得绕过行级安全（否则全部权限形同虚设）
//   least-privilege 最小权限：允许集合外的任何关系都**读不到**（「底表可达」的真正判据）
//   cdm-read        CDM 视图层：必需视图齐全且可读、**不可写**
//   contract        视图契约：不含 CDM 规范外的列、不含带直接标识的规范列
//   results-write   results schema：可建表、可清理（纯只读账号在这里失败）
//   metadata        cdm_source / vocabulary_version 可读
//
// 除 results 的「建一张探针表再删掉」外，全部走**权限自省**，对医院库零副作用。
// results 是连接器自己的可写区，在那里实建实删才是「能不能清理」的定论。
import { randomBytes } from 'node:crypto';
import { CdmExecutor, DataSourceError } from './cdm-executor';
import { CdmResultsScratch } from './cdm-results-scratch';
import { describeSource } from './data-source-config';

export type GateDomain =
  | 'role'
  | 'least-privilege'
  | 'cdm-read'
  | 'contract'
  | 'results-write'
  | 'metadata';

export interface GateCheck {
  id: string;
  domain: GateDomain;
  passed: boolean;
  detail: string;
}

export interface AccessGateReport {
  label: string;
  passed: boolean;
  checkedAt: string;
  /** 从库中读到的语义版本（spec: 语义版本必须从库中读取并留痕）。 */
  cdmVersion?: string;
  vocabularyVersion?: string;
  checks: GateCheck[];
}

/**
 * 本变更用到的 CDM 表（视图）与其 **CDM v5.4 规范列**。
 * 视图可以是规范列的子集（医院可以少给），但**不得多出规范外的列**——
 * 多出来的列（身份证号、姓名、手机号…）正是直接标识最常见的泄露方式。
 */
export const CDM_V54_COLUMNS: Record<string, readonly string[]> = {
  person: [
    'person_id', 'gender_concept_id', 'year_of_birth', 'month_of_birth', 'day_of_birth',
    'birth_datetime', 'race_concept_id', 'ethnicity_concept_id', 'location_id',
    'provider_id', 'care_site_id', 'person_source_value', 'gender_source_value',
    'gender_source_concept_id', 'race_source_value', 'race_source_concept_id',
    'ethnicity_source_value', 'ethnicity_source_concept_id',
  ],
  observation_period: [
    'observation_period_id', 'person_id', 'observation_period_start_date',
    'observation_period_end_date', 'period_type_concept_id',
  ],
  drug_exposure: [
    'drug_exposure_id', 'person_id', 'drug_concept_id', 'drug_exposure_start_date',
    'drug_exposure_start_datetime', 'drug_exposure_end_date', 'drug_exposure_end_datetime',
    'verbatim_end_date', 'drug_type_concept_id', 'stop_reason', 'refills', 'quantity',
    'days_supply', 'sig', 'route_concept_id', 'lot_number', 'provider_id',
    'visit_occurrence_id', 'visit_detail_id', 'drug_source_value', 'drug_source_concept_id',
    'route_source_value', 'dose_unit_source_value',
  ],
  condition_occurrence: [
    'condition_occurrence_id', 'person_id', 'condition_concept_id', 'condition_start_date',
    'condition_start_datetime', 'condition_end_date', 'condition_end_datetime',
    'condition_type_concept_id', 'condition_status_concept_id', 'stop_reason', 'provider_id',
    'visit_occurrence_id', 'visit_detail_id', 'condition_source_value',
    'condition_source_concept_id', 'condition_status_source_value',
  ],
  concept: [
    'concept_id', 'concept_name', 'domain_id', 'vocabulary_id', 'concept_class_id',
    'standard_concept', 'concept_code', 'valid_start_date', 'valid_end_date', 'invalid_reason',
  ],
  vocabulary: [
    'vocabulary_id', 'vocabulary_name', 'vocabulary_reference', 'vocabulary_version',
    'vocabulary_concept_id',
  ],
  cdm_source: [
    'cdm_source_name', 'cdm_source_abbreviation', 'cdm_holder', 'source_description',
    'source_documentation_reference', 'cdm_etl_reference', 'source_release_date',
    'cdm_release_date', 'cdm_version', 'cdm_version_concept_id', 'vocabulary_version',
  ],
};

/**
 * CDM 规范内、但**实践中承载直接标识**的列。`person_source_value` 按 ETL 惯例
 * 就是院内病案号（MRN）——它在规范里，照样不能出现在给连接器的视图中。
 */
export const IDENTIFIER_BEARING_CDM_COLUMNS: Record<string, readonly string[]> = {
  person: ['person_source_value'],
};

/** 词汇表类表放在 vocabulary schema，其余放在 cdm schema。 */
const VOCABULARY_TABLES = new Set(['concept', 'vocabulary']);

export class CdmAccessGate {
  constructor(private readonly executor: CdmExecutor) {}

  async run(): Promise<AccessGateReport> {
    const cfg = this.executor.config;
    const checks: GateCheck[] = [];
    const add = (id: string, domain: GateDomain, passed: boolean, detail: string) =>
      checks.push({ id, domain, passed, detail });

    // ── role：超级用户 / BYPASSRLS 会让视图与权限全部失效 ─────────────────────
    try {
      const [role] = await this.executor.query<{
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolbypassrls: boolean;
      }>({ text: this.executor.dialect.rolePropertiesQuery() });
      const flags = role
        ? (['rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb'] as const).filter(
            (f) => role[f],
          )
        : ['unknown'];
      add(
        'role-not-privileged',
        'role',
        flags.length === 0,
        flags.length === 0
          ? '连接器账号不是超级用户，也不能绕过行级安全'
          : `连接器账号带有 ${flags.join(' / ')}——超级用户与 BYPASSRLS 会绕过全部视图与权限，` +
              `契约形同虚设。请为连接器单独建普通账号`,
      );
    } catch (err) {
      add('role-not-privileged', 'role', false, this.explain(err, '读取账号属性'));
    }

    // ── least-privilege：允许集合外**读不到**任何关系 ─────────────────────────
    const allowed = [...new Set([cfg.schemas.cdm, cfg.schemas.vocabulary, cfg.schemas.results])];
    try {
      const leaks = await this.executor.query<{ schema: string; relation: string }>({
        text: this.executor.dialect.readableOutsideQuery(),
        values: [allowed],
      });
      // 按 schema 分组：DBA 要做的是「撤销哪些 schema 的权限」，而截断的表清单
      // 可能恰好把最要紧的那张（带直接标识的 person）藏在「等 N 个」后面。
      const bySchema = new Map<string, string[]>();
      for (const l of leaks) bySchema.set(l.schema, [...(bySchema.get(l.schema) ?? []), l.relation]);
      add(
        'no-access-outside-allowed-schemas',
        'least-privilege',
        leaks.length === 0,
        leaks.length === 0
          ? `允许集合（${allowed.join(', ')}）之外没有任何可读关系`
          : `连接器账号能读到允许集合之外的 ${leaks.length} 个关系（底表可达）——` +
              [...bySchema.entries()]
                .map(([schema, rels]) => `${schema}（${rels.length} 个：${rels.map((r) => `${schema}.${r}`).join(', ')}）`)
                .join('；') +
              `。请撤销 ${[...bySchema.keys()].join(', ')} 的权限——连接器只应看到视图层`,
      );
    } catch (err) {
      add('no-access-outside-allowed-schemas', 'least-privilege', false, this.explain(err, '检查越权可读'));
    }

    // ── cdm-read + contract：逐个必需视图 ───────────────────────────────────
    for (const [table, specColumns] of Object.entries(CDM_V54_COLUMNS)) {
      const schema = VOCABULARY_TABLES.has(table) ? cfg.schemas.vocabulary : cfg.schemas.cdm;
      const qualified = this.executor.dialect.qualify(schema, table);
      let columns: string[] | null = null;
      try {
        columns = await this.executor.columns({
          text: `SELECT * FROM ${qualified} ${this.executor.dialect.limitClause(0)}`,
        });
        add(`view-readable:${table}`, 'cdm-read', true, `${schema}.${table} 存在且可读`);
      } catch (err) {
        const kind = err instanceof DataSourceError ? err.kind : undefined;
        add(
          `view-readable:${table}`,
          'cdm-read',
          false,
          kind === 'undefined-object'
            ? `缺少必需的 CDM 视图 ${schema}.${table}`
            : kind === 'permission-denied'
              ? `视图 ${schema}.${table} 存在但连接器账号无 SELECT 权限`
              : this.explain(err, `读取 ${schema}.${table}`),
        );
      }

      if (columns) {
        const allowedCols = new Set(specColumns);
        const extra = columns.filter((c) => !allowedCols.has(c));
        const identifierBearing = (IDENTIFIER_BEARING_CDM_COLUMNS[table] ?? []).filter((c) =>
          columns!.includes(c),
        );
        const bad = [...extra, ...identifierBearing];
        add(
          `view-contract:${table}`,
          'contract',
          bad.length === 0,
          bad.length === 0
            ? `${schema}.${table} 只含 CDM v5.4 规范列`
            : `${schema}.${table} 含不应出现的列：${bad.join(', ')}` +
                (extra.length ? `（${extra.join(', ')} 不在 CDM v5.4 规范内，疑似直接标识）` : '') +
                (identifierBearing.length
                  ? `（${identifierBearing.join(', ')} 按 ETL 惯例承载病案号等直接标识）`
                  : '') +
                `。请在视图层去掉这些列`,
        );
      }

      // 视图不可写：权限自省，零副作用。
      try {
        const [row] = await this.executor.query<{ writable: boolean }>({
          text: this.executor.dialect.tableWritableQuery(),
          values: [`${schema}.${table}`],
        });
        add(
          `view-not-writable:${table}`,
          'cdm-read',
          !row?.writable,
          row?.writable
            ? `连接器账号对 ${schema}.${table} 有写权限——CDM 视图层必须只读`
            : `${schema}.${table} 对连接器只读`,
        );
      } catch (err) {
        // 视图都不存在时写权限检查自然失败，上面已报缺表，这里不重复计错。
        if (!(err instanceof DataSourceError && err.kind === 'undefined-object')) {
          add(`view-not-writable:${table}`, 'cdm-read', false, this.explain(err, `检查 ${table} 写权限`));
        }
      }
    }

    // ── results-write：可建表、可清理（纯只读账号在这里失败）────────────────
    try {
      const [row] = await this.executor.query<{ creatable: boolean }>({
        text: this.executor.dialect.schemaCreatableQuery(),
        values: [cfg.schemas.results],
      });
      if (!row?.creatable) {
        add(
          'results-creatable',
          'results-write',
          false,
          `连接器账号不能在 ${cfg.schemas.results} 建表。` +
            `队列定义需要把 cohort 写进 results schema——**纯只读账号不满足接入契约**。` +
            `请授予 USAGE, CREATE ON SCHEMA ${cfg.schemas.results}`,
        );
      } else {
        // 实建实删一张探针表：这是「能不能清理」的定论，且只发生在连接器自己的可写区。
        // 走中间结果表的命名约定与清理路径（task 6.3）：清不掉就是契约不成立；
        // 万一建完就崩溃，留下的探针也会被周期兜底清理认出来。
        const scratch = new CdmResultsScratch(this.executor);
        const probeTask = `access-gate:${randomBytes(6).toString('hex')}`;
        const probe = scratch.tableFor(probeTask, 'probe');
        await this.executor.query({ text: `CREATE TABLE ${probe.qualified} (probe INTEGER)` });
        const dropped = await scratch.dropTask(probeTask);
        if (!dropped.includes(probe.table)) {
          throw new Error(`探针表 ${probe.table} 建成了却清理不掉`);
        }
        add('results-creatable', 'results-write', true, `${cfg.schemas.results} 可建表、可清理`);
      }
    } catch (err) {
      add('results-creatable', 'results-write', false, this.explain(err, `在 ${cfg.schemas.results} 建探针表`));
    }

    // ── metadata：语义版本必须可读并留痕 ─────────────────────────────────────
    let cdmVersion: string | undefined;
    let vocabularyVersion: string | undefined;
    try {
      const [src] = await this.executor.query<{ cdm_version: string; vocabulary_version: string }>({
        text: `SELECT cdm_version, vocabulary_version
               FROM ${this.executor.dialect.qualify(cfg.schemas.cdm, 'cdm_source')}
               ${this.executor.dialect.limitClause(1)}`,
      });
      cdmVersion = src?.cdm_version?.trim();
      vocabularyVersion = src?.vocabulary_version?.trim();
      const versionOk = !!cdmVersion && cdmVersion.startsWith(cfg.cdmVersion);
      add(
        'cdm-source-readable',
        'metadata',
        !!cdmVersion && !!vocabularyVersion && versionOk,
        !cdmVersion || !vocabularyVersion
          ? 'cdm_source 表为空或缺版本字段——OHDSI 规范要求先填 cdm_source 再做任何分析'
          : !versionOk
            ? `库中声明的 CDM 版本 ${cdmVersion} 与配置的 ${cfg.cdmVersion} 不符`
            : `CDM ${cdmVersion} / 词汇表 ${vocabularyVersion}`,
      );
    } catch (err) {
      add('cdm-source-readable', 'metadata', false, this.explain(err, '读取 cdm_source'));
    }

    return {
      label: describeSource(cfg).label,
      passed: checks.every((c) => c.passed),
      checkedAt: new Date().toISOString(),
      ...(cdmVersion ? { cdmVersion } : {}),
      ...(vocabularyVersion ? { vocabularyVersion } : {}),
      checks,
    };
  }

  /** 把执行错误翻成医院 DBA 能看懂、且指明权限域的说明（不含口令）。 */
  private explain(err: unknown, action: string): string {
    if (err instanceof DataSourceError) {
      const reason = {
        'permission-denied': '权限不足',
        'undefined-object': '对象不存在',
        timeout: '查询超时',
        unavailable: '数据源不可达',
        'auth-failed': '认证失败（账号或口令错误）',
        'query-failed': '查询失败',
      }[err.kind];
      return `${action}：${reason}（${err.message}）`;
    }
    return `${action}：${(err as Error).message}`;
  }
}

/** 汇总失败项，按权限域分组——供错误信息与审计。 */
export function summarizeFailures(report: AccessGateReport): string {
  const failed = report.checks.filter((c) => !c.passed);
  if (failed.length === 0) return `数据源 ${report.label} 接入校验通过`;
  const byDomain = new Map<GateDomain, string[]>();
  for (const f of failed) {
    byDomain.set(f.domain, [...(byDomain.get(f.domain) ?? []), f.detail]);
  }
  const DOMAIN_LABEL: Record<GateDomain, string> = {
    role: '账号属性',
    'least-privilege': '最小权限',
    'cdm-read': 'CDM 视图只读域',
    contract: '视图契约',
    'results-write': 'results 可写域',
    metadata: '元数据',
  };
  return (
    `数据源 ${report.label} 接入校验未通过（${failed.length} 项）：` +
    [...byDomain.entries()]
      .map(([d, ds]) => `【${DOMAIN_LABEL[d]}】${ds.join('；')}`)
      .join(' ')
  );
}
