// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import {
  dedupIncidenceCount,
  encodeDedupIncidence,
  type DedupIncidenceInput,
  type DedupIncidenceResult,
} from '@medtrust/wasm-algorithms';

/**
 * 跨院去重发病率与罕见病登记的宿主适配：把多院解封后的队列投影装进 `dedup-incidence`
 * 模块的数字列 ABI，再把模块输出回填成 `rws.dedup-incidence@1` 载荷。
 *
 * 与 `scri-sandbox.ts` 同一套写法（投影 → 沙箱 → 回填 + 不变量校验），差别在 ABI 形状：
 * 头部 16 字节（观察/事件/罕见病行数与相邻合并开关），三组列按**固定布局**排列；
 * 列偏移由 `encodeDedupIncidence` 给出，`dedupIncidenceRequiredBytes` 必须与它逐字节一致
 * （测试里锁死这条一致性，避免「算少了内存」）。
 *
 * 留在宿主、**不进模块**的东西：主体键（关联假名）、日期文本、编码文本、分层键文本；
 * 模块只对宿主排好序的数字列做线性扫描（排序契约由模块校验，违反即拒）。
 */

export interface DedupIncidenceProjection {
  obsRows: number;
  eventRows: number;
  rareRows: number;
  strata: number;
  strataKeys: string[];
  /** 本次运行实际用的相邻合并开关（随结果如实记录，D-RWS-7）。 */
  mergeAdjacent: boolean;
  /** 输入观察期天数之和：用于校验「并集人日 ≤ 各段之和」。 */
  totalObservationDays: number;
  input: Uint8Array;
  outOff: number;
  outBytes: number;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function align8(value: number): number {
  return (value + 7) & ~7;
}

const HEADER = 16;
const CELL_BYTES = 16; // 每层 4 个 u32

/**
 * 需要的内存字节数（宿主在调用模块**之前**按沙箱上限拒）。
 *
 * **必须与 `encodeDedupIncidence` 的布局算法一致**（u8 列之后按 4 字节对齐）：
 * 测试里用真实投影逐字节对拍这条等式。
 */
export function dedupIncidenceRequiredBytes(input: {
  obsRows: number;
  eventRows: number;
  rareRows: number;
  strata: number;
}): number {
  const { obsRows, eventRows, rareRows } = input;
  let off = HEADER;
  off += obsRows * 4; // subjectObs
  off += obsRows; // stratumObs
  off = align4(off);
  off += obsRows * 4; // startDay
  off += obsRows * 4; // endDay
  off += eventRows * 4; // subjectEv
  off += eventRows; // stratumEv
  off = align4(off);
  off += eventRows * 4; // eventKey
  off += rareRows * 4; // subjectRare
  off += rareRows; // stratumRare
  return align8(off) + CELL_BYTES * input.strata;
}

/** 投影：归一化并排序后的三张表 → 模块输入载荷。 */
export function projectDedupIncidence(input: DedupIncidenceInput): DedupIncidenceProjection {
  const enc = encodeDedupIncidence(input);
  const L = enc.layout;
  const bytes = new Uint8Array(HEADER + L.bytes);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, enc.nObs, true);
  view.setInt32(4, enc.nEvents, true);
  view.setInt32(8, enc.nRare, true);
  view.setInt32(12, enc.mergeAdjacent, true);
  const put = (typed: Uint8Array | Uint32Array | Int32Array, rel: number) => {
    bytes.set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), HEADER + rel);
  };
  put(enc.subjectObs, L.subjectObs);
  put(enc.stratumObs, L.stratumObs);
  put(enc.startDay, L.startDay);
  put(enc.endDay, L.endDay);
  put(enc.subjectEv, L.subjectEv);
  put(enc.stratumEv, L.stratumEv);
  put(enc.eventKey, L.eventKey);
  put(enc.subjectRare, L.subjectRare);
  put(enc.stratumRare, L.stratumRare);

  let totalObservationDays = 0;
  for (let i = 0; i < enc.nObs; i++) totalObservationDays += enc.endDay[i] - enc.startDay[i] + 1;

  return {
    obsRows: enc.nObs,
    eventRows: enc.nEvents,
    rareRows: enc.nRare,
    strata: enc.strataKeys.length,
    strataKeys: enc.strataKeys,
    mergeAdjacent: enc.mergeAdjacent === 1,
    totalObservationDays,
    input: bytes,
    outOff: align8(bytes.length),
    outBytes: CELL_BYTES * enc.strataKeys.length,
  };
}

/**
 * 模块输出 → 结果，并校验四条不变量（design D3）：
 *  ① 去重人数 ≤ 观察行数；② 并集人日 ≤ 各段天数之和；③ 去重事件 ≤ 事件行数；④ 罕见病 ≤ 去重人数。
 *
 * 违反即整阶段失败：宁可不出结果，也不把「去重没生效」的数字交到发布审查。
 */
export function dedupIncidenceFromSandboxOutput(input: {
  projection: DedupIncidenceProjection;
  output: Uint8Array;
}): DedupIncidenceResult {
  const { projection, output } = input;
  if (output.length < projection.outBytes)
    throw new Error(`沙箱输出长度不足：${output.length} < ${projection.outBytes}`);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  let subjects = 0;
  let days = 0;
  let events = 0;
  const strata = projection.strataKeys.map((key, s) => {
    const uniqueSubjects = view.getUint32(s * CELL_BYTES, true);
    const personDaysUnion = view.getUint32(s * CELL_BYTES + 4, true);
    const eventsDeduped = view.getUint32(s * CELL_BYTES + 8, true);
    const rareCases = view.getUint32(s * CELL_BYTES + 12, true);
    subjects += uniqueSubjects;
    days += personDaysUnion;
    events += eventsDeduped;
    return { key, uniqueSubjects, personDaysUnion, eventsDeduped, rareCases };
  });
  if (subjects > projection.obsRows)
    throw new Error(
      `沙箱输出不变量违反：去重人数 ${subjects} > 观察行数 ${projection.obsRows}`,
    );
  if (days > projection.totalObservationDays)
    throw new Error(
      `沙箱输出不变量违反：并集人日 ${days} > 各段天数之和 ${projection.totalObservationDays}（并集没生效）`,
    );
  if (events > projection.eventRows)
    throw new Error(`沙箱输出不变量违反：去重事件 ${events} > 事件行数 ${projection.eventRows}`);
  for (const s of strata)
    if (s.rareCases > s.uniqueSubjects)
      throw new Error(
        `沙箱输出不变量违反：罕见病 ${s.rareCases} > 去重人数 ${s.uniqueSubjects}（层 ${s.key}）`,
      );
  return {
    analysisType: 'dedup-incidence',
    mergeAdjacent: projection.mergeAdjacent,
    windowed: false,
    strata,
  };
}

/**
 * 出域候选（C3）：分层的四项计数 + **两套**发布审查判据。
 *
 * - `buckets[].count` = 非零的（去重人数, 去重事件）较小值 → 常规阈值 `minCell` 判；
 * - `rareBuckets[].count` = 罕见病例数 → **罕见病专用阈值** `minCellRare` 判（更高，单独抑制）。
 *
 * 这样降密算子能对罕见病列单独抑制，而不必把整层砍掉（design D5）。
 * 不输出合计：合计减去未抑制分层就能反推被抑制的那层。
 */
export function dedupIncidencePayload(result: DedupIncidenceResult): Record<string, unknown> {
  return {
    analysisType: 'dedup-incidence',
    mergeAdjacent: result.mergeAdjacent,
    windowed: result.windowed,
    strata: result.strata.map((s) => ({ ...s })),
    buckets: result.strata.map((s) => {
      const nonZero = [s.uniqueSubjects, s.eventsDeduped].filter((v) => v > 0);
      return { key: s.key, count: nonZero.length ? Math.min(...nonZero) : 0 };
    }),
    rareBuckets: result.strata.map((s) => ({ key: s.key, count: s.rareCases })),
  };
}

/** 参考语义（测试对拍用；执行路径走模块）。 */
export function dedupIncidenceReference(input: DedupIncidenceInput): DedupIncidenceResult {
  return dedupIncidenceCount(input);
}
