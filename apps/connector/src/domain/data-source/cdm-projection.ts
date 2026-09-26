// omop-data-source-access —— 投影下推到 SQL（task 2b，D-CN-6；分析语义边界见 omop-data-source-access D8）。
//
// 文件路径是「JSON → InternalRecord[] → 内存筛 → 投影」；CDM 路径**不照搬**这个形态，
// 而是把列裁剪与行过滤写进 SQL，取回的就已经是最小列：
//
//   人员 + 暴露标记   SELECT person_id, EXISTS(...) AS exposed   —— 药物过滤在 SQL 里
//   事件             SELECT person_id, term                     —— 只要这两列
//
// 取回后交给与文件路径**同一个**投影构造器（buildDisproportionalityProjection），
// 两条路径在投影载荷处汇合，沙箱 / 输出闸门 / 存证链路完全不变。
//
// 边界（omop-data-source-access D8）：这里交付的是**机制**。药物按 concept_id 匹配，不移植文件路径的
// 模糊字符串匹配；而「全部诊断当不良事件、不设时间窗」只适合机制验证，不是正确的
// 药物警戒定义——CDM 上的生产分析语义由 Circe 变更提供，本模块不接入生产派发。
import {
  buildDisproportionalityProjection,
  type DisproportionalityProjection,
} from '../sandbox/disproportionality-sandbox';
import { CdmExecutor, type SqlStatement } from './cdm-executor';

/** 药物引用：优先 concept_id；名称只做 concept_name 的精确（不区分大小写）匹配。 */
export interface CdmDrugRef {
  conceptIds?: number[];
  name?: string;
}

export class CdmProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdmProjectionError';
  }
}

export interface CdmProjectionResult {
  projection: DisproportionalityProjection;
  /** 解析出的药物 concept_id（留痕：结论依赖的是哪几个概念）。 */
  drugConceptIds: number[];
  /** 本次实际发出的语句（审计与「不得全量拉取」的可验证证据）。 */
  statements: SqlStatement[];
}

/**
 * 解析药物概念。解析不到 → fail-closed：绝不能把所有人都当作「未暴露」继续算，
 * 那会产出一个看似正常、实则毫无意义的 2×2 表。
 */
export async function resolveDrugConcepts(
  executor: CdmExecutor,
  drug: CdmDrugRef,
  log: SqlStatement[] = [],
): Promise<number[]> {
  if (drug.conceptIds && drug.conceptIds.length > 0) {
    const ids = drug.conceptIds.map(Number);
    if (!ids.every((id) => Number.isInteger(id) && id > 0)) {
      throw new CdmProjectionError(`药物 concept_id 须为正整数：${drug.conceptIds.join(',')}`);
    }
    return [...new Set(ids)].sort((a, b) => a - b);
  }
  const name = drug.name?.trim();
  if (!name) throw new CdmProjectionError('须指定药物 concept_id 或名称');

  const d = executor.dialect;
  const statement: SqlStatement = {
    text: `SELECT concept_id FROM ${d.qualify(executor.config.schemas.vocabulary, 'concept')}
           WHERE lower(concept_name) = lower(${d.placeholder(1)})
           ORDER BY concept_id`,
    values: [name],
  };
  log.push(statement);
  const rows = await executor.query<{ concept_id: number }>(statement);
  if (rows.length === 0) {
    throw new CdmProjectionError(
      `词汇表中找不到药物「${name}」的概念（按 concept_name 精确匹配）。` +
        `CDM 路径不做模糊字符串匹配——请改用 concept_id 指定`,
    );
  }
  return rows.map((r) => Number(r.concept_id));
}

/**
 * L1.5 失衡检测的 CDM 投影：两条下推查询 → 同一个投影构造器。
 * 返回的 statements 可用于证明「只取了需要的列、没有全表拉取」。
 */
export async function projectDisproportionalityFromCdm(
  executor: CdmExecutor,
  drug: CdmDrugRef,
): Promise<CdmProjectionResult> {
  const d = executor.dialect;
  const { cdm, vocabulary } = executor.config.schemas;
  const statements: SqlStatement[] = [];
  const drugConceptIds = await resolveDrugConcepts(executor, drug, statements);

  // ① 人员 + 暴露标记：药物过滤写在 SQL 里，只回两列。
  const personsStatement: SqlStatement = {
    text: `SELECT p.person_id,
                  EXISTS (
                    SELECT 1 FROM ${d.qualify(cdm, 'drug_exposure')} de
                    WHERE de.person_id = p.person_id
                      AND ${d.anyOf('de.drug_concept_id', d.placeholder(1))}
                  ) AS exposed
           FROM ${d.qualify(cdm, 'person')} p
           ORDER BY p.person_id`,
    values: [drugConceptIds],
  };
  statements.push(personsStatement);
  const persons = await executor.query<{ person_id: string | number; exposed: boolean }>(
    personsStatement,
  );

  // ② 事件：只回 (person_id, term) 两列；词条文本留在宿主侧、按下标回填，不进沙箱。
  const eventsStatement: SqlStatement = {
    text: `SELECT co.person_id, c.concept_name AS term
           FROM ${d.qualify(cdm, 'condition_occurrence')} co
           JOIN ${d.qualify(vocabulary, 'concept')} c
             ON c.concept_id = co.condition_concept_id
           ORDER BY co.person_id, co.condition_occurrence_id`,
  };
  statements.push(eventsStatement);
  const events = await executor.query<{ person_id: string | number; term: string }>(
    eventsStatement,
  );

  // person_id 只在宿主侧用于对齐行；进入沙箱的只有 0/1 标记位。
  const rowOf = new Map<string, number>();
  persons.forEach((p, i) => rowOf.set(String(p.person_id), i));
  const rowTerms: string[][] = persons.map(() => []);
  for (const e of events) {
    const i = rowOf.get(String(e.person_id));
    // 视图层行级过滤可能让某些 condition 找不到对应 person——那正是医院想挡掉的人，跳过。
    if (i !== undefined) rowTerms[i].push(e.term);
  }

  return {
    projection: buildDisproportionalityProjection(
      persons.map(() => true), // 入组规则（队列 / 时间窗）属 Circe 变更，这里全部入组
      persons.map((p) => Boolean(p.exposed)),
      rowTerms,
    ),
    drugConceptIds,
    statements,
  };
}
