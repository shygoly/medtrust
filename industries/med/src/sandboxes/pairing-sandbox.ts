// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import {
  encodeForModule,
  type PairPartyTable,
  type PairResult,
} from '@medtrust/wasm-algorithms';

/**
 * 跨持有方**主体配对**的宿主适配（任务 3.12f）：把节点内解封后的投影装进配对模块的
 * 数字列 ABI，再把模块输出回填成 `rws.paired-cohort@1` 载荷。
 *
 * 与 `domain/sandbox/disproportionality-sandbox.ts` 是同一套写法（投影 → 沙箱 → 回填 + 不变量校验），
 * 差别只有 ABI 形状：配对模块是 `run(inOff, parties, n, strata, outOff)`（5 参），
 * 因此调用时必须在请求里明确 `abi: 'pairing@1'`——**沙箱不认识模块语义，但必须认识调用形状**。
 *
 * 三处刻意留在宿主一侧（**不进模块、不进沙箱内存里的字符串**）：
 *  ① **主体键**：模块只认「已对齐的下标与标志」，键文本留在宿主（也是 §3.12b 的决策中立点：
 *     共享盐还是跨院 PSI 对齐，模块与本文一行不改）；
 *  ② **分层键**：`ageBand|sex` → 分层编号的映射在宿主，模块只收编号；
 *  ③ **参与方顺序**：由阶段参数的输入顺序决定（不是消息到达顺序）。
 */

export interface PairingProjection {
  /** 参与方数（＝表数）。 */
  parties: number;
  /** 全空间主体数（各表主体的并集，按 key 排序去重）。 */
  subjects: number;
  /** 分层数。 */
  strata: number;
  /** 分层键（顺序即模块收到的分层编号 0..k-1）。 */
  strataKeys: string[];
  /** ABI 输入载荷：`present[n*parties] ‖ exposure[n] ‖ outcome[n] ‖ stratum[n]`。 */
  input: Uint8Array;
  /** 输出区偏移（4 字节对齐）与字节数（16 + 12×strata）。 */
  outOff: number;
  outBytes: number;
  /** 主体键（宿主侧留档用；**不进**模块，也不进任何出域载荷）。 */
  subjectKeys: string[];
}

/** 需要的内存字节数（宿主在调用模块**之前**按沙箱上限拒；不给模块分配的机会）。 */
export function pairingRequiredBytes(input: {
  parties: number;
  subjects: number;
  strata: number;
}): number {
  const inBytes = input.subjects * input.parties + 3 * input.subjects;
  return roundUp4(inBytes) + 16 + 12 * input.strata;
}

/** 投影：对齐后的各方表 → 模块输入载荷。对齐本身由数据侧负责（见文件头说明）。 */
export function projectPairing(input: {
  tables: readonly PairPartyTable[];
  /** 分层取值列表（缺省：按各方行里出现过的 `ageBand|sex` 排序）。 */
  strataKeys?: readonly string[];
}): PairingProjection {
  if (input.tables.length < 2)
    throw new Error('跨持有方配对至少需要两方（单方配对没有意义）');
  const strataKeys = [...(input.strataKeys ?? defaultStrataKeys(input.tables))];
  const encoded = encodeForModule({ tables: input.tables, strataKeys });
  const input_ = new Uint8Array(
    encoded.present.length + encoded.exposure.length + encoded.outcome.length + encoded.stratum.length,
  );
  let offset = 0;
  input_.set(encoded.present, offset);
  offset += encoded.present.length;
  input_.set(encoded.exposure, offset);
  offset += encoded.exposure.length;
  input_.set(encoded.outcome, offset);
  offset += encoded.outcome.length;
  input_.set(encoded.stratum, offset);

  const outOff = roundUp4(input_.length);
  return {
    parties: encoded.parties,
    subjects: encoded.subjects,
    strata: strataKeys.length,
    strataKeys,
    input: input_,
    outOff,
    outBytes: 16 + 12 * strataKeys.length,
    subjectKeys: encoded.subjectKeys,
  };
}

/**
 * 回填：模块输出 → `rws.paired-cohort@1` 载荷（与 TS 参考语义 `pairIntersection` 同形状）。
 *
 * 不变量逐条校验（输出被改过、或宿主给错了参数，都在这里露出来）：
 * 交集规模不超过主体总数；每个分层的 `cohort ≤ cohortSize`；`both ≤ exposed`、`exposed ≤ cohort`。
 */
export function pairedCohortFromSandboxOutput(input: {
  projection: PairingProjection;
  output: Uint8Array;
  /** 参与方标识（顺序与投影一致；只作出域元数据，不含任何主体键）。 */
  parties: readonly string[];
}): PairResult {
  const { projection, output, parties } = input;
  const required = 16 + 12 * projection.strata;
  if (output.length < required)
    throw new Error(`沙箱输出长度不足：${output.length} < ${required}（分层数 ${projection.strata}）`);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const cohortSize = view.getUint32(0, true);
  const exposed = view.getUint32(4, true);
  const outcome = view.getUint32(8, true);
  const both = view.getUint32(12, true);
  if (cohortSize > projection.subjects)
    throw new Error(`沙箱输出不变量违反：交集规模 ${cohortSize} > 主体总数 ${projection.subjects}`);
  if (both > exposed || exposed > cohortSize)
    throw new Error(
      `沙箱输出不变量违反：暴露/结局计数不合法（exposed=${exposed} both=${both} cohort=${cohortSize}）`,
    );

  const strata = projection.strataKeys.map((key, s) => {
    const base = 16 + s * 12;
    const exposedInStratum = view.getUint32(base, true);
    const bothInStratum = view.getUint32(base + 4, true);
    const cohortInStratum = view.getUint32(base + 8, true);
    if (cohortInStratum > cohortSize || exposedInStratum > cohortInStratum || bothInStratum > exposedInStratum)
      throw new Error(
        `沙箱输出不变量违反：分层 ${key} 的计数不合法` +
          `（cohort=${cohortInStratum} exposed=${exposedInStratum} both=${bothInStratum}）`,
      );
    return {
      key,
      exposed: exposedInStratum,
      outcome: 0,
      exposedWithOutcome: bothInStratum,
      cohortSize: cohortInStratum,
      rate: exposedInStratum ? bothInStratum / exposedInStratum : 0,
    };
  });

  return {
    analysisType: 'paired-cohort',
    cohortSize,
    exposed,
    outcome,
    exposedWithOutcome: both,
    rate: exposed ? both / exposed : 0,
    strata,
    parties: [...parties],
  };
}

/** 出域载荷（C3 候选）：只带聚合量，**没有主体键、没有行**。 */
export function pairedCohortPayload(result: PairResult): Record<string, unknown> {
  return {
    analysisType: 'paired-cohort',
    cohortSize: result.cohortSize,
    exposed: result.exposed,
    outcome: result.outcome,
    exposedWithOutcome: result.exposedWithOutcome,
    rate: result.rate,
    // **规范聚合形状**：平台侧的收集方按它校验并（多节点时）求和，
    // 形状与 `apps/api/src/mdop/operators/collect-paired-cohort.ts` 的 `PairedCohortCell` 对齐。
    // 这一处曾经缺失（节点只出 `buckets`），结果平台收集阶段以「缺分层表」拒收——
    // 由 §8.5 的 C2 单进程端到端用例抓到（分块用例各自都过）。
    strata: result.strata.map((s) => ({
      key: s.key,
      exposed: s.exposed,
      outcome: s.outcome,
      exposedWithOutcome: s.exposedWithOutcome,
      cohortSize: s.cohortSize,
      rate: s.rate,
    })),
    // 发布审查（小单元格抑制）读的是 `buckets`；过闸门后由降密算子把 `strata` 对齐到同一份判定
    buckets: result.strata.map((s) => ({ key: s.key, count: s.exposed, rate: s.rate })),
  };
}

/** 缺省分层键：各方行里出现过的 `ageBand|sex`，排序后固定编号（确定性优先）。 */
function defaultStrataKeys(tables: readonly PairPartyTable[]): string[] {
  const keys = new Set<string>();
  for (const table of tables)
    for (const row of table.rows) keys.add(`${row.ageBand ?? 'all'}|${row.sex ?? 'all'}`);
  return [...keys].sort();
}

function roundUp4(value: number): number {
  return value + ((4 - (value % 4)) % 4);
}
