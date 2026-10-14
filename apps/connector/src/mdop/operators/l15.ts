import { Logger } from '@nestjs/common';
import type { InternalRecord } from '../../domain/types';
import type { MdopStageExecutor, StageInput } from '../mdop-executor';

/**
 * L1.5 失衡检测的四个算子在连接器侧的三个实现（任务 9.2–9.4）。
 *
 * 计划固定为：`source.dataset@1` → `rws.disproportionality@1` → `declassify.small_cell@1` → 投递平台。
 * 每个 handler 都是**纯接线**：真实的数据加载、去标识化、wasm 沙箱、输出闸门都由外部注入，
 * 这样本模块既能在院内跑真实链路，也能在单测里用替身逐段对拍。
 *
 * 数据流与等级：
 *   ds://<node>/<dataProductId>  →  C0 行数据（本地库/文件，永不出节点）
 *   2×2 四格表                   →  C0（仍是明细级计数）
 *   过闸门后的四格表             →  C3（可发布，交给合约接收方）
 */

export interface ProportionalityBucket {
  key: string;
  count: number;
  rate: number;
  b: number;
  c: number;
  d: number;
}

export interface L15OperatorDeps {
  /** 按数据产品 id 取本地去标识化行（走既有加载与去标识化路径）。 */
  loadRows(dataProductId: string): Promise<readonly InternalRecord[]>;
  /**
   * 数据快照标识（§9.2）：文件数据源取**文件字节的 SM3**；取不到返回 null
   * （调用方回退到确定性派生值，并在复核时与执行时一致比对）。
   */
  snapshotOf(dataProductId: string): Promise<string | null> | string | null;
  /**
   * 经**已登记的 wasm 模块**执行 2×2 计数（§9.3，走现有零能力沙箱）。
   * 未接入或模块未固定时抛错 —— 不回退到内置实现（fail-closed）。
   */
  runProportionality(
    rows: readonly InternalRecord[],
    drug: string,
    opts: { stage: StageInput },
  ): Promise<{ buckets: ProportionalityBucket[]; moduleSm3: string }>;
  /** 输出闸门（§9.4）：读合约 minCell，做小单元格抑制与二次抑制，返回可发布的 C3 载荷。 */
  gate(candidate: unknown, minCell: number, meta?: { contractId?: string }): Record<string, unknown>;
}

export const L15_OPS = {
  source: 'source.dataset@1.0.0',
  disproportionality: 'rws.disproportionality@1.0.0',
  declassify: 'declassify.small_cell@1.0.0',
} as const;

export const L15_DATASET_URI_PREFIX = 'ds://';

/** `ds://<node>/<dataProductId>` → dataProductId（段数不符即拒）。 */
export function dataProductIdFromUri(uri: string): string {
  const rest = (uri ?? '').replace(L15_DATASET_URI_PREFIX, '');
  const slash = rest.indexOf('/');
  const productId = slash >= 0 ? rest.slice(slash + 1) : '';
  if (!productId) throw new Error(`数据源句柄非法（应为 ds://<node>/<dataProductId>）：${uri}`);
  return productId;
}

/** 四格表载荷（对拍与合并都用它）。 */
export interface ProportionalityTable {
  analysisType: 'disproportionality';
  cohortSize: number;
  buckets: ProportionalityBucket[];
}

export function registerL15Operators(
  executor: MdopStageExecutor,
  deps: L15OperatorDeps,
  logger: Logger = new Logger('L15Operators'),
): void {
  // ① 数据源：把 ds:// 句柄绑定到既有加载与去标识化，输出 C0；
  //    同时把**文件字节 SM3** 作为本节点快照标识随载荷带走（复核/执行两次比对）。
  executor.registerSystem(L15_OPS.source, async (input) => {
    const uri = String(input.stage.params.uri ?? input.stage.inputs[0]?.from ?? '');
    const productId = dataProductIdFromUri(uri);
    const rows = await deps.loadRows(productId);
    const snapshot = await deps.snapshotOf(productId);
    logger.log(`source.dataset 载入 product=${productId} rows=${rows.length}`);
    return {
      label: 'C0',
      schema: 'mdop.dataset/1.0',
      payload: {
        productId,
        n: rows.length,
        snapshot,
        // 行数据只在本节点内存与本地制品库里流转，永不进消息
        rows: rows as unknown as Record<string, unknown>[],
      },
    };
  });

  // ② 失衡检测：**wasm 类算子**——执行必须经沙箱跑已登记的模块摘要，输出仍为 C0。
  //    这里把「沙箱桥」注册成 wasm runner（清单 kind=wasm，故走 wasm 分支）。
  executor.setWasmRunner(async (opRef, moduleDigest, input) => {
    if (!opRef.startsWith('rws.disproportionality@'))
      throw new Error(`本节点没有该 wasm 算子的执行实现：${opRef}`);
    const bare = (v: string) => v.replace(/^sm3:/, '').toLowerCase();
    if (input.stage.op_digest && bare(input.stage.op_digest) !== bare(moduleDigest))
      throw new Error('阶段声明的模块摘要与清单不符（拒绝执行）');
    const source = [...input.inputs.values()][0] as
      | { rows?: InternalRecord[]; productId?: string }
      | undefined;
    if (!source?.rows) throw new Error('rws.disproportionality 缺上游数据集');
    const drug = String(input.stage.params.drug ?? '');
    if (!drug) throw new Error('rws.disproportionality 需要参数 drug');
    const { buckets, moduleSm3 } = await deps.runProportionality(source.rows, drug, {
      stage: input,
    });
    const table: ProportionalityTable = {
      analysisType: 'disproportionality',
      cohortSize: source.rows.length,
      buckets,
    };
    logger.log(
      `rws.disproportionality 完成 events=${buckets.length} module=${moduleSm3.slice(0, 16)}…`,
    );
    return { label: 'C0', schema: 'mdop.table/1.0', payload: table as unknown as Record<string, unknown> };
  });

  // ③ 降密：读合约 minCell 过输出闸门（含二次抑制），输出 C3。
  // 链上第一环：认领「四格表」载荷；别的载荷（如 L4 的模型）**婉拒**，交给下一环。
  executor.appendSystemHandler(L15_OPS.declassify, async (input) => {
    const table = [...input.inputs.values()][0] as unknown as ProportionalityTable | undefined;
    if (!table?.buckets) return undefined;
    const contractMinCell = Number(
      (input.contractTerms as { publication?: { minCell?: number } } | undefined)?.publication
        ?.minCell ?? 0,
    );
    const paramMinCell = Number(input.stage.params.minCell ?? 0);
    // 复核/编译已校验「参数不得弱于合约」；这里再拦一次（纵深防御）
    const minCell = Math.max(contractMinCell, paramMinCell);
    if (!minCell) throw new Error('declassify.small_cell 需要合约或参数给出 minCell');
    const released = deps.gate(table, minCell, {
      contractId: String(input.stage.params.contractId ?? ''),
    });
    logger.log(`declassify.small_cell 过闸门 minCell=${minCell}`);
    return { label: 'C3', schema: 'mdop.table/1.0', payload: released };
  });
}
