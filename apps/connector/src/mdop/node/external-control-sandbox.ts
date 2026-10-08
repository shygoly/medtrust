/**
 * 单臂试验真实世界外部对照（D1）—— 节点内沙箱执行助手（镜像 ve-tnd-sandbox 工艺）。
 *
 * 宿主职责：行形状校验、按（分层, 索引日, 假名）排序（模型编码内完成）、
 * 内存布局与不变量校验；模块只见数字列（天数与 0/1 结局）。
 */
import {
  encodeExternalControl,
  type ExternalControlRow,
  type ExternalControlTrialRow,
  type ExternalControlInput,
  type ExternalControlResult,
  type ExternalControlStratum,
} from '@medtrust/wasm-algorithms';

const HEADER = 16;
const CELL_BYTES = 24;

export interface ExternalControlProjection {
  trial: number;
  controls: number;
  strata: number;
  strataKeys: string[];
  caliperDays: number;
  ratioK: number;
  trialPerStratum: number[];
  input: Uint8Array;
  outOff: number;
  outBytes: number;
}

export function projectExternalControl(
  input: ExternalControlInput & { trialRows: readonly ExternalControlTrialRow[]; controlRows: readonly ExternalControlRow[] },
): ExternalControlProjection {
  const enc = encodeExternalControl(input);
  const bytes = new Uint8Array(HEADER + enc.nTrial * 6 + enc.nCtrl * 6);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, enc.nTrial, true);
  view.setInt32(4, enc.nCtrl, true);
  view.setInt32(8, enc.caliperDays, true);
  view.setInt32(12, enc.ratioK, true);
  bytes.set(new Uint8Array(enc.trialDay.buffer, enc.trialDay.byteOffset, enc.trialDay.byteLength), HEADER);
  bytes.set(enc.trialOutcome, HEADER + enc.nTrial * 4);
  bytes.set(enc.trialStratum, HEADER + enc.nTrial * 5);
  bytes.set(new Uint8Array(enc.ctrlDay.buffer, enc.ctrlDay.byteOffset, enc.ctrlDay.byteLength), HEADER + enc.nTrial * 6);
  bytes.set(enc.ctrlOutcome, HEADER + enc.nTrial * 6 + enc.nCtrl * 4);
  bytes.set(enc.ctrlStratum, HEADER + enc.nTrial * 6 + enc.nCtrl * 5);
  const trialPerStratum = new Array<number>(enc.strataKeys.length).fill(0);
  for (const s of enc.trialStratum) trialPerStratum[s]! += 1;
  const outOff = (bytes.length + 7) & ~7;
  return {
    trial: enc.nTrial,
    controls: enc.nCtrl,
    strata: enc.strataKeys.length,
    strataKeys: enc.strataKeys,
    caliperDays: enc.caliperDays,
    ratioK: enc.ratioK,
    trialPerStratum,
    input: bytes,
    outOff,
    outBytes: CELL_BYTES * enc.strataKeys.length,
  };
}

/**
 * 模块输出 → 结果，并校验不变量（宁可整阶段失败，不把算错的计数交发布审查）：
 *  ① 每层 matched + unmatched = 该层试验受试者数；
 *  ② 每层 mExpPos + mExpNeg = matched（匹配试验组才计入主分析）；
 *  ③ 每层 ctlPos + ctlNeg ≤ ratioK × matched（对照配额不被突破）。
 */
export function externalControlFromSandboxOutput(input: {
  projection: ExternalControlProjection;
  output: Uint8Array;
}): ExternalControlResult {
  const { projection, output } = input;
  if (output.length < projection.outBytes)
    throw new Error(`沙箱输出长度不足：${output.length} < ${projection.outBytes}`);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const strata: ExternalControlStratum[] = projection.strataKeys.map((key, s) => {
    const row = {
      key,
      mExpPos: view.getUint32(s * CELL_BYTES, true),
      mExpNeg: view.getUint32(s * CELL_BYTES + 4, true),
      ctlPos: view.getUint32(s * CELL_BYTES + 8, true),
      ctlNeg: view.getUint32(s * CELL_BYTES + 12, true),
      matched: view.getUint32(s * CELL_BYTES + 16, true),
      unmatched: view.getUint32(s * CELL_BYTES + 20, true),
    };
    if (row.matched + row.unmatched !== projection.trialPerStratum[s])
      throw new Error(
        `沙箱输出不变量违反：${key} 匹配+未匹配 ${row.matched + row.unmatched} ≠ 受试者 ${projection.trialPerStratum[s]}`,
      );
    if (row.mExpPos + row.mExpNeg !== row.matched)
      throw new Error(`沙箱输出不变量违反：${key} 匹配试验组计数 ${row.mExpPos + row.mExpNeg} ≠ matched ${row.matched}`);
    if (row.ctlPos + row.ctlNeg > projection.ratioK * row.matched)
      throw new Error(
        `沙箱输出不变量违反：${key} 对照计数 ${row.ctlPos + row.ctlNeg} > ${projection.ratioK} × ${row.matched}`,
      );
    return row;
  });
  return {
    analysisType: 'external-control',
    caliperDays: projection.caliperDays,
    ratioK: projection.ratioK,
    strata,
  };
}

export function externalControlPayload(result: ExternalControlResult): Record<string, unknown> {
  return {
    analysisType: 'external-control',
    caliperDays: result.caliperDays,
    ratioK: result.ratioK,
    strata: result.strata.map((s) => ({ ...s })),
    buckets: result.strata.map((s) => {
      const persons = [s.matched, s.ctlPos + s.ctlNeg].filter((v) => v > 0);
      return { key: s.key, count: persons.length ? Math.min(...persons) : 0 };
    }),
  };
}

/** 参考语义（测试对拍用；执行路径走模块）。 */
export function externalControlReference(input: ExternalControlInput): ExternalControlResult {
  return require('@medtrust/wasm-algorithms').externalControlCount(input);
}
