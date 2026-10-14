// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
/**
 * `rws.dedup-incidence@1.0.0` 的节点侧整段执行（搬移自 wasm-runner#runDedupIncidence，同函数体）。
 * `flattenDedupCohorts` 属该分析专用，随包搬走；出域判据仍调宿主的。
 */
import type { SandboxHost, StageSandbox } from "@medtrust/space-kernel-spi";
import { MdopError } from "@medtrust/mdop";
import type {
  DedupEventRow,
  DedupIncidenceInput,
  DedupObservationRow,
  DedupRareRow,
} from "@medtrust/wasm-algorithms";

import {
  dedupIncidenceFromSandboxOutput,
  dedupIncidencePayload,
  dedupIncidenceRequiredBytes,
  projectDedupIncidence,
} from "./dedup-incidence-sandbox";

export { flattenDedupCohorts };
/** 把各院队列投影摊平成模型要的三张表（观察期 / 事件 / 罕见病）；缺关键字段即拒。 */
function flattenDedupCohorts(rows: readonly unknown[]): {
  observations: DedupObservationRow[];
  events: DedupEventRow[];
  rareDiseases: DedupRareRow[];
} {
  const observations: DedupObservationRow[] = [];
  const events: DedupEventRow[] = [];
  const rareDiseases: DedupRareRow[] = [];
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const subjectKey = String(row.subjectKey ?? '');
    const obs = row.observation as { start?: unknown; end?: unknown } | undefined;
    if (!subjectKey || !obs || typeof obs.start !== 'string' || typeof obs.end !== 'string')
      throw new MdopError(
        'E_RUNTIME',
        {},
        '跨院去重投影缺 subjectKey 或 observation{start,end}（拒绝执行）',
      );
    const layer = {
      subjectKey,
      ...(typeof row.ageBand === 'string' ? { ageBand: row.ageBand } : {}),
      ...(typeof row.sex === 'string' ? { sex: row.sex } : {}),
    };
    observations.push({ ...layer, start: obs.start, end: obs.end });
    for (const rawEvent of Array.isArray(row.events) ? row.events : []) {
      const event = rawEvent as { code?: unknown; date?: unknown };
      events.push({ ...layer, code: String(event.code ?? ''), date: String(event.date ?? '') });
    }
    const rare = row.rareDisease as { code?: unknown; firstDate?: unknown } | null | undefined;
    if (rare && typeof rare === 'object')
      rareDiseases.push({
        ...layer,
        code: String(rare.code ?? ''),
        firstDate: String(rare.firstDate ?? ''),
      });
  }
  return { observations, events, rareDiseases };
}

/**
 * 跨院去重的发病率与罕见病登记。多院按 `params.roles = {cohorts: [urn…]}` 绑定，
 * **少于两家即拒**（只有一家时本地聚合即可，不该走可信空间节点）。
 *
 * 去重（人头并集 / 观察期并集 / 事件去重 / 罕见病按人计数）全部发生在模块内，
 * 各院拿不到任何「某人是否跨院」的信息。
 */

export const dedupIncidenceStageSandbox: StageSandbox = {
  opRef: "rws.dedup-incidence@1.0.0",
  async runStage(host: SandboxHost) {
    const stageInput = host.stageInput as {
      stage: { params: Record<string, unknown>; output_schema: string };
    };
    const params = stageInput.stage.params;
    const roles = (params.roles ?? {}) as { cohorts?: unknown };
    const cohortUrns = Array.isArray(roles.cohorts)
      ? roles.cohorts.filter((v): v is string => typeof v === 'string')
      : [];
    if (cohortUrns.length < 2)
      throw new MdopError(
        'E_RUNTIME',
        {},
        '跨院去重阶段至少需要两个 cohort 角色（一家时本地聚合即可）',
      );
    const rows = host.rowsByRole(
      host.stageInput,
      Object.fromEntries(cohortUrns.map((urn, i) => [`cohort${i + 1}`, urn])),
      "跨院去重",
    );
    const allRows = cohortUrns.flatMap((_, i) => [...(rows.get(`cohort${i + 1}`) ?? [])]);
    const eventCodes = host.codeWhitelist(params, "eventCodes", "跨院去重");
    const rareCodes = host.codeWhitelist(params, "rareCodes", "跨院去重");
    const strataKeys = host.strataKeys(params.strataKeys, "跨院去重阶段参数");
    const flat = flattenDedupCohorts(allRows);
    const projection = projectDedupIncidence({
      ...flat,
      mergeAdjacent: params.mergeAdjacent !== false,
      ...(eventCodes ? { eventCodes } : {}),
      ...(rareCodes ? { rareCodes } : {}),
      ...(strataKeys ? { strataKeys } : {}),
    } satisfies DedupIncidenceInput);
    const n = projection.obsRows + projection.eventRows + projection.rareRows;
    const result = await host.runSandbox({
      analysisType: "dedup-incidence",
      input: projection.input,
      abi: "dedup-incidence@1",
      n,
      k: projection.strata,
      outOff: projection.outOff,
      outBytes: projection.outBytes,
      requiredBytes: dedupIncidenceRequiredBytes({
        obsRows: projection.obsRows,
        eventRows: projection.eventRows,
        rareRows: projection.rareRows,
        strata: projection.strata,
      }),
    });
    return {
      schema: stageInput.stage.output_schema,
      payload: dedupIncidencePayload(
        dedupIncidenceFromSandboxOutput({ projection, output: result.output }),
      ),
    };
  },
};
