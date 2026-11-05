// 脱敏编排：规格 → 降级检测 → 院内 agent → 回执校验 → 交回脱敏块。
// 决策：D-CN-9（口径由平台签发、院内执行、盐归医院、异常 fail-closed）。
//
// 连接器是**唯一控制点**（design §2）：它持数据源权限、做受限投影（D-CN-6）、
// 决定用哪个规格，并且只有回执全部对上才把数据交给本地存储/计算。
//
// 硬约束（design §7）：
//   · 规格验签失败 / 已吊销 / 与合约不一致 / 盐缺失 / 超 row_limit → 抛错，任务失败；
//   · **绝不**退回内置弱脱敏（`agent` 模式下本地脱敏是明确禁止的路径）；
//   · agent 不可达/超时同样失败，不做"本地近似"。
import type { DeidSpec } from '@medtrust/mdop';
import { stableStringify } from '../canonical-json';
import { sm3Hex } from '../sm3';
import { AgentDeidClient, type AgentDeidReceipt } from './agent-deid-client';
import { assertNoDowngrade, deidRequirementOf, type DeidContractRequirement } from './downgrade';
import { assertNoBuiltinBypass, resolveDeidMode, type DeidMode } from './deid-mode';
import { DeidSpecRejected, type DeidSpecStore, type StoredDeidSpec } from './spec-package';
import { DeidDictionaryStore } from './dictionary-manifest';
import type { ContractView } from '../contract-view';

export interface DeidRunRequest {
  jobId: string;
  contract?: ContractView;
  rows: readonly Record<string, unknown>[];
  /** 院内 KMS/Vault 的盐引用（只给引用，不给盐本身）。 */
  saltRef: string;
  rowLimit?: number;
}

export interface DeidRunResult {
  rows: Record<string, unknown>[];
  /** 本次用到的词表引用（未涉及词表时为 null）。 */
  dictionaryRef: string | null;
  /** 本次执行用的规格摘要（落审计与本地存储的可追溯键）。 */
  specSm3: string;
  specId: string;
  specVersion: number;
  receipt: AgentDeidReceipt;
  inputDigest: string;
  outputDigest: string;
}

export interface DeidAuditSink {
  record(entry: {
    action: string;
    actor: string;
    allowed: boolean;
    detail: string;
  }): void;
}

export class DeidReceiptMismatch extends Error {
  constructor(message: string) {
    super(`DEID_RECEIPT_MISMATCH: ${message}`);
    this.name = 'DeidReceiptMismatch';
  }
}

/**
 * 连接器侧脱敏编排。
 *
 * `run()` 是**唯一**允许走 agent 的入口：任何绕过（本地逐行脱敏）在 agent 模式下
 * 都会命中 {@link assertNoBuiltinBypass}。
 */
export class DeidRunner {
  private readonly mode: DeidMode;

  constructor(
    private readonly specs: DeidSpecStore,
    private readonly agent: AgentDeidClient,
    private readonly audit?: DeidAuditSink,
    mode?: DeidMode,
    /**
     * 词表清单视图。**缺省空 store**：没装载任何清单时，引用词表的规格一律
     * `DICTIONARY_NOT_AVAILABLE` —— 默认就是 fail-closed，不需要额外的开关。
     */
    private readonly dictionaries: DeidDictionaryStore = new DeidDictionaryStore(),
  ) {
    this.mode = mode ?? resolveDeidMode();
  }

  currentMode(): DeidMode {
    return this.mode;
  }

  /** 连接器想自己脱敏时的守卫：agent 模式下一律拒。 */
  assertBuiltinAllowed(where: string): void {
    assertNoBuiltinBypass(this.mode, where);
  }

  async run(request: DeidRunRequest): Promise<DeidRunResult> {
    if (this.mode !== 'agent')
      throw new Error(
        '内置脱敏模式不支持本次调用：agent 通道未启用（CONNECTOR_DEID_MODE=builtin）',
      );

    const requirement = deidRequirementOf(request.contract);
    if (!requirement)
      throw new DeidSpecRejected(
        'SPEC_SCOPE_MISMATCH',
        '合约未绑定脱敏口径条款（privacy.deid），拒绝执行 agent 脱敏',
      );

    // 1) 取本院持有的规格：没有/已吊销/已过期 → 直接失败，不猜不兜底。
    const stored: StoredDeidSpec = this.specs.requireActive(requirement.specId!);

    // 2) 降级检测：规格必须与合约口径一致（缺字段/keep/k 调低/关小格抑制 → 拒）。
    assertNoDowngrade(stored.spec, requirement satisfies DeidContractRequirement);

    // 3) 词表：规格里引用了 `dictionaryRef` 就必须先拿到平台签名的摘要，
    //    再把 ref + 摘要交给 agent（agent 核对本院文件的 SM3）。拿不到就失败。
    const dictionary = this.resolveDictionary(stored);

    // 4) 调院内 agent（双向流；数据不出院）。
    const result = await this.agent.run({
      jobId: request.jobId,
      contractId: request.contract?.id ?? '',
      spec: JSON.parse(stableStringify(stored.spec)) as Record<string, unknown>,
      saltRef: request.saltRef,
      rows: request.rows,
      rowLimit: request.rowLimit,
      ...(dictionary
        ? { dictionaryRef: dictionary.ref, dictionarySm3: dictionary.sm3 }
        : {}),
    });

    // 5) 回执校验：摘要必须**本地重算**，不采信对方声称的值。
    //    输入摘要按发出去的行重算；输出摘要按收到的字节重算（见 AgentDeidRunResult.outputSm3）。
    const inputDigest = digestRows(request.rows);
    const outputDigest = result.outputSm3;
    verifyReceipt({
      receipt: result.receipt,
      specSm3: stored.specSm3,
      inputDigest,
      outputDigest,
      rowCount: result.rows.length,
    });

    this.audit?.record({
      action: 'deid-agent-run',
      actor: 'connector',
      allowed: true,
      detail:
        `job=${request.jobId} spec=${stored.specId}@v${stored.version} ` +
        `${dictionary ? `dict=${dictionary.ref} ` : ''}` +
        `sm3=${stored.specSm3.slice(0, 16)}… rows=${result.rows.length} in=${inputDigest.slice(0, 12)}… ` +
        `out=${outputDigest.slice(0, 12)}… agent=${result.receipt.agentReceipt.slice(0, 12)}…`,
    });

    return {
      rows: result.rows,
      dictionaryRef: dictionary?.ref ?? null,
      specSm3: stored.specSm3,
      specId: stored.specId,
      specVersion: stored.version,
      receipt: result.receipt,
      inputDigest,
      outputDigest,
    };
  }

  /**
   * 规格里所有 `text_rules.dictionaryRef` 都必须能在本地解析到清单。
   * 多个字段引用不同词表时全部解析（任何一个缺失都失败）。
   */
  private resolveDictionary(
    stored: StoredDeidSpec,
  ): { ref: string; sm3: string } | null {
    const refs = new Set<string>();
    for (const transform of stored.spec.transforms) {
      if (transform.op !== 'text_rules') continue;
      const ref = transform.params?.dictionaryRef;
      if (typeof ref === 'string' && ref.trim()) refs.add(ref.trim());
    }
    if (refs.size === 0) return null;
    if (refs.size > 1)
      throw new DeidSpecRejected(
        'SPEC_SCHEMA_INVALID',
        `本版只支持一个词表引用，规格里出现 ${refs.size} 个（${[...refs].join(', ')}）`,
      );
    return this.dictionaries.require([...refs][0]);
  }
}

/**
 * 逐行规范化摘要（与 agent 侧同口径）：`stableStringify(row) + "\n"` 顺序拼接后 SM3。
 *
 * 注意：**输入**摘要可在两侧独立重算（连接器知道发出去的每一行）；
 * **输出**摘要只能由 agent 产出的字节重算 —— 见 `agent-deid-client` 收到的原始块。
 */
export function digestRows(rows: readonly Record<string, unknown>[]): string {
  return sm3Hex(rows.map((row) => `${stableStringify(row)}\n`).join(''));
}

export function verifyReceipt(input: {
  receipt: AgentDeidReceipt;
  specSm3: string;
  inputDigest: string;
  outputDigest: string;
  rowCount: number;
}): void {
  const { receipt } = input;
  if (receipt.ackStatus !== 'OK')
    throw new DeidReceiptMismatch(
      `agent 未成功完成（ack=${receipt.ackStatus}）：${receipt.message || '无说明'}`,
    );
  if (receipt.specSm3.toLowerCase() !== input.specSm3.toLowerCase())
    throw new DeidReceiptMismatch(
      `规格摘要不符：agent 回报 ${receipt.specSm3.slice(0, 16)}… ≠ 本地 ${input.specSm3.slice(0, 16)}…`,
    );
  if (receipt.inputDigest.toLowerCase() !== input.inputDigest.toLowerCase())
    throw new DeidReceiptMismatch(
      `输入摘要不符：agent 回报 ${receipt.inputDigest.slice(0, 16)}… ≠ 本地重算 ${input.inputDigest.slice(0, 16)}…`,
    );
  if (receipt.outputDigest.toLowerCase() !== input.outputDigest.toLowerCase())
    throw new DeidReceiptMismatch(
      `输出摘要不符：agent 回报 ${receipt.outputDigest.slice(0, 16)}… ≠ 本地重算 ${input.outputDigest.slice(0, 16)}…`,
    );
  if (receipt.rowCount !== input.rowCount)
    throw new DeidReceiptMismatch(
      `行数不符：agent 回报 ${receipt.rowCount} ≠ 实际收到 ${input.rowCount}`,
    );
  if (!receipt.agentReceipt)
    throw new DeidReceiptMismatch('agent 未给出本地审计链摘要（agent_receipt 为空）');
}

export type { DeidSpec };
