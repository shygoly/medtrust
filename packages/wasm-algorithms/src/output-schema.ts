// third-party-module-admission 闸 3 —— 防外泄:输出通道管控（design D3）。
//
// 零能力沙箱里数据出去的唯一通道就是**合法输出**，所以火力集中在这里:
//   · 宿主只喂「最小整数列投影」(原始标识 MUST NOT 进入模块) —— 见 projection 侧;
//   · 输出必须符合**窄低熵 schema**:整数、限定值域、字段数固定;
//   · 输出必须对**行序**与**标识符扰动**不变(打乱多重集 → 逐字节不变);
//   · 注入 canary 记录 MUST NOT 能从输出复原;
//   · 最后仍过既有输出闸门(小格 <5 抑制、行级拦截)。
//
// 这里放的是**可判定**的那几条:低熵 schema 校验、行序不变性差分、canary 不可复原。

export class OutputSchemaError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "not-integer"
      | "out-of-range"
      | "wrong-arity"
      | "excess-precision"
      | "entropy-exceeded",
  ) {
    super(message);
    this.name = "OutputSchemaError";
  }
}

/**
 * 低熵输出 schema:每个字段是一个**无符号整数**，落在声明值域内。
 * 「计数返成带多位尾数噪声的浮点」是最经典的夹带信道 —— 直接在这里判死。
 */
export interface LowEntropyOutputSchema {
  /** 字段个数（固定 arity，不许可变长输出）。 */
  fieldCount: number;
  /** 每个字段的闭区间值域 [min, max]；单值表示所有字段共用。 */
  range: [number, number] | Array<[number, number]>;
  /**
   * 整个输出的信息量上限（bit）。缺省按各字段值域宽度求和。
   * 用来挡「值域看着合法、但字段多到足够把一条记录塞出来」的情形。
   */
  maxEntropyBits?: number;
}

function rangeAt(
  schema: LowEntropyOutputSchema,
  index: number,
): [number, number] {
  return Array.isArray(schema.range[0])
    ? (schema.range as Array<[number, number]>)[index]
    : (schema.range as [number, number]);
}

/** schema 允许的最大信息量（bit）——各字段值域宽度的 log2 求和。 */
export function schemaEntropyBits(schema: LowEntropyOutputSchema): number {
  let bits = 0;
  for (let i = 0; i < schema.fieldCount; i += 1) {
    const [min, max] = rangeAt(schema, i);
    bits += Math.log2(Math.max(1, max - min + 1));
  }
  return bits;
}

/**
 * 校验一组输出值符合低熵 schema。违反即抛 —— 调用方 MUST 拒绝该模块（闸 3）。
 */
export function assertLowEntropyOutput(
  values: readonly number[],
  schema: LowEntropyOutputSchema,
): void {
  if (values.length !== schema.fieldCount) {
    throw new OutputSchemaError(
      `输出字段数 ${values.length} ≠ 声明 ${schema.fieldCount}（不许可变长输出）`,
      "wrong-arity",
    );
  }
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      throw new OutputSchemaError(
        `输出字段 #${i} 非有限数：${v}`,
        "not-integer",
      );
    }
    if (!Number.isInteger(v)) {
      throw new OutputSchemaError(
        `输出字段 #${i} 不是整数：${v}（计数带尾数噪声是典型夹带信道）`,
        "excess-precision",
      );
    }
    const [min, max] = rangeAt(schema, i);
    if (v < min || v > max) {
      throw new OutputSchemaError(
        `输出字段 #${i} 值 ${v} 越出声明值域 [${min}, ${max}]`,
        "out-of-range",
      );
    }
  }
  const cap = schema.maxEntropyBits;
  if (cap !== undefined && schemaEntropyBits(schema) > cap) {
    throw new OutputSchemaError(
      `输出 schema 信息量 ${schemaEntropyBits(schema).toFixed(1)}bit > 上限 ${cap}bit`,
      "entropy-exceeded",
    );
  }
}

/**
 * 行序不变性差分（闸 3）：同一多重集打乱行序后再跑，输出 MUST 逐字节不变。
 * 「用顺序偷藏」是零能力沙箱里少数还能用的夹带手法 —— 差分直接把它打掉。
 *
 * 返回首个不一致的字节下标；完全一致返回 -1。
 */
export function firstByteDivergence(
  a: Uint8Array,
  b: Uint8Array,
): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

export function outputsIdentical(a: Uint8Array, b: Uint8Array): boolean {
  return firstByteDivergence(a, b) === -1;
}

/**
 * 确定性排列：用一个确定的种子打乱行下标。
 * 测试要可复现，所以不能用 Math.random —— 否则失败无法重放。
 */
export function deterministicPermutation(n: number, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  // xorshift32：小、确定、够乱。
  let s = seed >>> 0 || 0x9e3779b9;
  for (let i = n - 1; i > 0; i -= 1) {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    const j = s % (i + 1);
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  return idx;
}

/**
 * canary 不可复原性检查（闸 3）。
 *
 * 做法：在输入里注入一条只有宿主知道的「金丝雀」记录，比较「含 canary」与
 * 「不含 canary」两次输出。模块**允许**把 canary 计入聚合计数（那是它的本职），
 * 但两次输出的差必须**只落在预期的计数位上、且幅度 ≤1**；任何别处的变化都说明
 * 模块在把 canary 的内容编码进输出。
 *
 * 返回不合规的字段下标列表（空 = 通过）。
 */
export function canaryLeakFields(
  withoutCanary: readonly number[],
  withCanary: readonly number[],
  /** 允许因 canary 而 +0/+1 的计数字段下标。 */
  expectedCountFields: readonly number[],
): number[] {
  const allowed = new Set(expectedCountFields);
  const leaks: number[] = [];
  const len = Math.max(withoutCanary.length, withCanary.length);
  for (let i = 0; i < len; i += 1) {
    const before = withoutCanary[i] ?? 0;
    const after = withCanary[i] ?? 0;
    const delta = after - before;
    if (delta === 0) continue;
    if (!allowed.has(i) || delta < 0 || delta > 1) leaks.push(i);
  }
  return leaks;
}
