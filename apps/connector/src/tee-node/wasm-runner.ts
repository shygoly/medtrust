import { Logger } from '@nestjs/common';
import {
  MAX_STRATUM_KEYS,
  MdopError,
  isNonEmptyStringList,
  isStratumKey,
  stratumKeyListProblem,
} from '@medtrust/mdop';
import type {
  DistinctCountRow,
  PairPartyTable,
} from '@medtrust/wasm-algorithms';
import {
  externalControlFromSandboxOutput,
  externalControlPayload,
  projectExternalControl,
} from '../mdop/node/external-control-sandbox';
import type {
  ExternalControlRow,
  ExternalControlTrialRow,
} from '@medtrust/wasm-algorithms';
import { WasmSandboxRunner } from '../domain/sandbox/sandbox-runner';
import type { MdopStageExecutor, StageInput, WasmRunner } from '../mdop/mdop-executor';
import type { SandboxHost, SandboxRunRequest } from '@medtrust/space-kernel-spi';
import type { SandboxAbi } from '../domain/sandbox/sandbox-runner';
import { currentConnectorSpaceId } from '../space/space-context';

import { resolveSandbox } from './sandbox-registry';
import {
  distinctCountFromSandboxOutput,
  distinctCountPayload,
  distinctCountRequiredBytes,
  projectDistinctCount,
} from '../mdop/node/distinct-count-sandbox';

/**
 * 节点侧的 **wasm 算子执行接线**（任务 3.12f）：把「注册中心签发的模块」真的跑起来。
 *
 * 没有这一层，节点侧的配对阶段在真实部署里**一步也跑不了**：`MdopStageExecutor` 对 `wasm` 类算子
 * 要求本节点接入沙箱执行器，而节点组件此前没有任何 wasm 接线（用例里都是自己塞一个假的 runner）。
 *
 * 三条判据都在调用模块**之前**完成，任一条不过即拒、不回退到内置实现：
 *  ① 算子引用必须是本节点实现了的那几个（白名单在代码里，清单在注册中心，两者对不上就不跑）；
 *  ② 阶段声明的 `op_digest` 必须与清单摘要一致（清单被换过即拒）；
 *  ③ 模块字节必须能按摘要取到（节点本地的模块库；取不到就不跑）。
 *
 * 另外两处刻意设计：
 *  - **ABI 形状由宿主显式给出**（`abi: 'pairing@1'` / `abi: 'distinct-count@1'`）：
 *    模块自述不作数，沙箱按宿主说的形状调；
 *  - **对齐与分层留在宿主**：模块只认数字列，见 `@medtrust/domain-med` 的 `sandboxes/pairing-sandbox.ts`
 *    与 `mdop/node/distinct-count-sandbox.ts`。
 *
 * 所有 wasm 算子都从 `createNodeWasmRunner` 返回的那一个函数过——这里是「节点在解封后的明文上
 * 跑算子」的**唯一入口**，因此三条与出域有关的规矩也钉在这一处（评审遗留，2026-10-07）：
 *  - **错误文案不带数据**：算子执行期抛出的非 `MdopError`（参考模型的编码器会把行值写进文案，
 *    如「日期不可解析：<取值>」；宿主适配的不变量校验会把审查前计数写进文案）一律只进**节点本地日志**，
 *    对外换成固定文案（阶段失败状态会原样上报给平台，见 `stage-dispatch.ts`）；
 *  - **编码白名单参数**：给了就必须是非空数组、每一项非空字符串，否则拒
 *    （不给可以——持有方封存时已强制过滤；给一份无效的则不能被当成「不过滤」）；
 *  - **分层键**：`strataKeys` 参数与算子结果里的每一个层键都必须符合闭合语法
 *    （`@medtrust/mdop` 的 `isStratumKey`），否则本阶段失败、结果到不了发布审查。
 */

/** 本节点实现（已接线到沙箱）的 wasm 算子。新增一种就在这里加一条，并在下面加分派。 */
export const NODE_WASM_OPS = {
  pairedCohort: 'rws.paired-cohort@1.0.0',
  distinctCount: 'rws.distinct-count@1.0.0',
  vaccineScri: 'rws.vaccine-scri@1.0.0',
  veTnd: 'rws.ve-tnd@1.0.0',
  dedupIncidence: 'rws.dedup-incidence@1.0.0',
  externalControl: 'rws.external-control@1.0.0',
} as const;

const NODE_WASM_OP_REFS: readonly string[] = Object.values(NODE_WASM_OPS);

export interface NodeWasmDeps {
  /**
   * 按 SM3 摘要取模块字节：**节点本地的模块库**（已验签、已加白）。
   * 取不到即拒——不去平台现取（那等于让执行时机依赖网络与另一个信任面）。
   */
  moduleBytes(digest: string): Uint8Array | undefined;
  /** 沙箱执行器（缺省新建一个；装配方注入便于审计与复用）。 */
  runner?: WasmSandboxRunner;
  /** 分层取值列表（缺省按投影里出现过的分层键排序；给了就固定编号顺序）。 */
  strataKeys?: readonly string[];
  /**
   * **节点本地**日志（缺省用 Nest Logger）。算子执行期的原始错误只写到这里，不随阶段状态出节点。
   * 可注入是为了让用例能断言「原文确实留在了本地、而且带着作业号与阶段号」。
   */
  logger?: { error(message: string, stack?: string): void };
}

const bare = (value: string): string => value.replace(/^sm3:/, '').toLowerCase();

/**
 * 算子执行失败时**对外**的固定文案（随 `StageStatus FAILED` 上报给平台）。
 *
 * 文案里没有任何可变成分：不带行值、不带计数、不带数据规模。原因细节（哪一行、哪个取值、
 * 哪条不变量、沙箱超时还是超内存）只在节点本地日志里，按作业号与阶段号检索。
 */
export const NODE_OPERATOR_FAILURE_MESSAGE =
  '节点内算子执行失败：输入、输出或沙箱资源校验未通过（详情只留在节点本地日志）';

/**
 * 编码白名单参数。**不给（`undefined`）放行**：持有方封存时白名单是必填的，节点拿到的投影已经过滤过。
 * 给了就必须是非空数组、每一项非空字符串——一份无效的白名单若被悄悄当成「没给」，
 * 就等于参数被人改坏时节点反而放宽了口径。
 */
function optionalCodeWhitelist(
  params: Record<string, unknown>,
  name: string,
  opName: string,
): string[] | undefined {
  const value = params[name];
  if (value === undefined) return undefined;
  if (!isNonEmptyStringList(value))
    throw new MdopError(
      'E_RUNTIME',
      {},
      `${opName} 阶段参数 ${name} 不是有效的编码白名单（必须是非空数组且每一项为非空字符串；拒绝执行）`,
    );
  return [...value];
}

/** 分层键列表不合规的固定说明（只有类别，不回显那段文本）。 */
const STRATA_KEYS_PROBLEM = {
  'not-array': '必须是数组',
  'too-many': `至多 ${MAX_STRATUM_KEYS} 个`,
  'bad-key': '每一项必须符合 <年龄段>|<性别> 的闭合语法',
  duplicate: '不得有重复的分层键',
} as const;

/** 固定分层顺序：不给放行（按节点内出现过的取值，结果里的层键另有校验）；给了就必须逐项合语法。 */
function checkedStrataKeys(value: unknown, source: string): string[] | undefined {
  if (value === undefined) return undefined;
  const problem = stratumKeyListProblem(value);
  if (problem)
    throw new MdopError(
      'E_RUNTIME',
      {},
      `${source} strataKeys 不合规：${STRATA_KEYS_PROBLEM[problem]}（拒绝执行）`,
    );
  return [...(value as string[])];
}

/**
 * 算子结果里的层键校验（发布审查**之前**）：`strata` / `buckets` / `rareBuckets` 里每一项的 `key`
 * 都必须符合闭合语法，否则本阶段失败。
 *
 * 为什么参数校验之后还要这一道：没给 `strataKeys` 时层键取自持有方行里的 `ageBand|sex`，
 * 持有方封存时判过一次（`operators/seal.ts`），但节点不该只信上游——这是出域前最后一个
 * 还知道「这段文本是层键」的地方（发布审查只按计数抑制，不看键的内容）。
 * 说明里不回显不合规的键：它正是不该出域的那段文本。
 */
function assertResultStratumKeys(payload: Record<string, unknown>, opRef: string): void {
  for (const field of ['strata', 'buckets', 'rareBuckets'] as const) {
    const cells = payload[field];
    if (cells === undefined) continue;
    if (!Array.isArray(cells) || !cells.every(hasStratumKey))
      throw new MdopError(
        'E_RELEASE_CHECK_FAILED',
        {},
        `${opRef} 的结果含不符合闭合语法的分层键（${field}）：不得进入发布审查`,
      );
  }
}

const hasStratumKey = (cell: unknown): boolean =>
  typeof cell === 'object' && cell !== null && isStratumKey((cell as { key?: unknown }).key);

/** 造一个可挂到 `MdopStageExecutor#setWasmRunner` 的执行器（只认本节点实现的那几个算子）。 */
export function createNodeWasmRunner(deps: NodeWasmDeps): WasmRunner {
  const runner = deps.runner ?? new WasmSandboxRunner();
  const logger = deps.logger ?? new Logger('NodeWasmRunner');
  const runOperator = createOperatorDispatch(deps, runner);
  return async (opRef: string, moduleDigest: string, input: StageInput) => {
    let produced: Awaited<ReturnType<WasmRunner>>;
    try {
      produced = await runOperator(opRef, moduleDigest, input);
    } catch (err) {
      // `MdopError` 是本文件与协议核自己抛的：文案逐条审过、不带行值与计数，原样上抛
      // （参数不合规、缺绑定、摘要不符这类，平台需要看见原因）。
      if (err instanceof MdopError) throw err;
      // 其余一律视为「在明文上算的时候出的错」：原文可能带行值或审查前计数，只留本地。
      const detail = err instanceof Error ? err.message : String(err);
      logger.error(
        `节点内算子执行失败 job=${input.jobId} stage=${input.stage.id} op=${opRef}：${detail}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new MdopError('E_RUNTIME', {}, NODE_OPERATOR_FAILURE_MESSAGE);
    }
    assertResultStratumKeys(produced.payload, opRef);
    return produced;
  };
}

/** 三条执行前判据 + 按算子引用分派（不含错误处置与结果校验——那两件事在上面的统一入口）。 */
function createOperatorDispatch(deps: NodeWasmDeps, runner: WasmSandboxRunner): WasmRunner {
  return async (opRef: string, moduleDigest: string, input: StageInput) => {
    if (!NODE_WASM_OP_REFS.includes(opRef))
      throw new MdopError(
        'E_CAPABILITY_MISMATCH',
        {},
        `本节点没有该 wasm 算子的执行实现：${opRef}`,
      );
    if (input.stage.op_digest && bare(input.stage.op_digest) !== bare(moduleDigest))
      throw new MdopError('E_CAPABILITY_MISMATCH', {}, '阶段声明的模块摘要与清单不符（拒绝执行）');
    const bytes = deps.moduleBytes(bare(moduleDigest));
    if (!bytes)
      throw new MdopError('E_CAPABILITY_MISMATCH', {}, `本节点没有该模块的字节：${moduleDigest}`);

    // 行业包注册的阶段沙箱（change `pack-med-sandboxes`）：包做整段执行，基座只分派与把守住判据。
    // 解析不到就继续走下面的内置分支 —— 未迁移的算子行为一字不变。
    const sandbox = resolveSandbox(opRef);
    if (sandbox) {
      const host = buildSandboxHost({ deps, runner, input, moduleDigest, bytes });
      return (await sandbox.runStage(host)) as Awaited<ReturnType<WasmRunner>>;
    }

    if (opRef === NODE_WASM_OPS.distinctCount) {
      return runDistinctCount({ runner, deps, input, moduleDigest, bytes });
    }
    if (opRef === NODE_WASM_OPS.externalControl) {
      return runExternalControl({ runner, input, moduleDigest, bytes });
    }

    // 注册表没接、内置分支也没有：显式 fail-closed（MUST NOT 静默返回空）。
    // 前置白名单拦掉的是未实现的算子；这里兜住「白名单里有、但两条路都没接」的漏配。
    throw new MdopError(
      'E_CAPABILITY_MISMATCH',
      {},
      `本节点没有该 wasm 算子的执行实现：${opRef}`,
    );
  };
}

async function runDistinctCount(input: {
  runner: WasmSandboxRunner;
  deps: NodeWasmDeps;
  input: StageInput;
  moduleDigest: string;
  bytes: Uint8Array;
}) {
  const { runner, deps, input: stageInput, moduleDigest, bytes } = input;
  const rows = distinctCountRows(stageInput);
  const fixedStrata = checkedStrataKeys(deps.strataKeys, '节点配置的');
  const projection = projectDistinctCount({
    rows,
    ...(fixedStrata ? { strataKeys: fixedStrata } : {}),
  });
  runner.assertWithinMemoryLimit(
    distinctCountRequiredBytes({
      subjects: projection.subjects,
      strata: projection.strata,
    }),
  );
  const result = await runner.run({
    analysisType: 'distinct-count',
    moduleSm3: moduleDigest,
    moduleBytes: bytes,
    input: projection.input,
    abi: 'distinct-count@1',
    n: projection.subjects,
    k: projection.strata,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
  });
  const counted = distinctCountFromSandboxOutput({
    projection,
    output: result.output,
  });
  return {
    schema: stageInput.stage.output_schema,
    payload: distinctCountPayload(counted),
  };
}

/**
 * 构造交给行业包的**宿主面**（change `pack-med-sandboxes` design D2）：
 * 三条出域判据留在基座 —— 错误文案脱敏在 `createNodeWasmRunner` 的统一入口、编码白名单与分层键由这里提供、
 * 结果层键由统一入口复校；包只拿到**已被放行**的输入与执行原语。
 */
function buildSandboxHost(args: {
  deps: NodeWasmDeps;
  runner: WasmSandboxRunner;
  input: StageInput;
  moduleDigest: string;
  bytes: Uint8Array;
}): SandboxHost {
  const { deps, runner, input, moduleDigest, bytes } = args;
  return {
    spaceId: currentConnectorSpaceId(),
    stageInput: input,
    moduleSm3: bare(moduleDigest),
    rowsByRole: (stageInput, roles, label) =>
      rowsByRole(stageInput as StageInput, roles as Record<string, unknown>, label),
    codeWhitelist: (params, name, opName) =>
      optionalCodeWhitelist(params as Record<string, unknown>, name, opName),
    tables: (stageInput) => pairingTables(stageInput as StageInput),
    strataKeys: (value, source) => checkedStrataKeys(value, source),
    configuredStrataKeys: (source) => checkedStrataKeys(deps.strataKeys, source),
    runSandbox: async (request: SandboxRunRequest) => {
      runner.assertWithinMemoryLimit(request.requiredBytes);
      const result = await runner.run({
        analysisType: request.analysisType,
        moduleSm3: moduleDigest,
        moduleBytes: bytes,
        input: request.input,
        // SPI 的 `abi` 是 `string`（保持领域中立）；在内核边界转成执行器的联合类型，
        // 执行器自己的 ABI 兼容闸仍会核对模块，形状不对照样 fail-closed。
        abi: request.abi as SandboxAbi,
        // 执行器的请求类型把 n/k 定为必填（本文件这几条 ABI 都用得到）；SPI 侧保持可选，
        // 缺失时按 0 兜底——形状不对仍会被执行器自己的 ABI 闸挡下，不静默算错。
        n: request.n ?? 0,
        k: request.k ?? 0,
        ...(request.parties !== undefined ? { parties: request.parties } : {}),
        ...(request.strata !== undefined ? { strata: request.strata } : {}),
        outOff: request.outOff,
        outBytes: request.outBytes,
      });
      return { output: result.output };
    },
  };
}
/** 按角色 URN 从 `params.parties` 绑定里取该持有方的投影行；缺绑定即拒（绝不按输入顺序猜）。 */
function rowsByRole(
  stageInput: StageInput,
  roles: Record<string, unknown>,
  opName: string,
): Map<string, readonly unknown[]> {
  const tables = pairingTables(stageInput);
  const out = new Map<string, readonly unknown[]>();
  for (const [role, node] of Object.entries(roles)) {
    const table = tables.find((t) => t.node === node);
    if (!table)
      throw new MdopError(
        'E_RUNTIME',
        {},
        `${opName} 阶段找不到角色 ${role} 对应的输入：${String(node)}`,
      );
    out.set(role, table.rows as readonly unknown[]);
  }
  return out;
}

/** 单臂试验真实世界外部对照：按角色绑定（trial = 申办方，controls = 医院），节点内确定性窗口匹配。 */
async function runExternalControl(input: {
  runner: WasmSandboxRunner;
  input: StageInput;
  moduleDigest: string;
  bytes: Uint8Array;
}) {
  const { runner, input: stageInput, moduleDigest, bytes } = input;
  const params = stageInput.stage.params as Record<string, unknown>;
  const roles = (params.roles ?? {}) as { trial?: unknown; controls?: unknown };
  const rows = rowsByRole(stageInput, { trial: roles.trial, controls: roles.controls }, '外部对照');
  const trialRows = sanitizeExternalControlRows(rows.get('trial'), 'trial');
  const controlRows = sanitizeExternalControlRows(rows.get('controls'), 'controls');
  const strataKeys = checkedStrataKeys(params.strataKeys, '外部对照阶段参数');
  if (!strataKeys || strataKeys.length === 0) throw new MdopError('E_RUNTIME', {}, '外部对照缺 strataKeys（拒绝执行）');
  const caliperDays = Number(params.caliperDays ?? 30);
  const ratioK = Number(params.ratioK ?? 2);
  const projection = projectExternalControl({
    trialRows,
    controlRows,
    strataKeys,
    caliperDays,
    ratioK,
  });
  runner.assertWithinMemoryLimit(projection.outOff + projection.outBytes);
  const result = await runner.run({
    analysisType: 'external-control',
    moduleSm3: moduleDigest,
    moduleBytes: bytes,
    input: projection.input,
    abi: 'external-control@1',
    n: projection.trial + projection.controls,
    k: projection.strata,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
  });
  return {
    schema: stageInput.stage.output_schema,
    payload: externalControlPayload(
      externalControlFromSandboxOutput({ projection, output: result.output }),
    ),
  };
}

/** 行形状校验：缺关键字段或结局非 pos/neg 即拒（节点不信投影自述）。 */
function sanitizeExternalControlRows(
  rows: readonly unknown[] | undefined,
  side: 'trial' | 'controls',
): ExternalControlTrialRow[] {
  if (!rows || rows.length === 0)
    throw new MdopError('E_RUNTIME', {}, `外部对照 ${side} 侧输入为空（拒绝执行）`);
  const out: ExternalControlTrialRow[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const subjectKey = typeof r.subjectKey === 'string' ? r.subjectKey : undefined;
    const ageBand = typeof r.ageBand === 'string' ? r.ageBand : undefined;
    const sex = typeof r.sex === 'string' ? r.sex : undefined;
    const indexDate = typeof r.indexDate === 'string' ? r.indexDate : undefined;
    const outcome = r.outcome === 'pos' || r.outcome === 'neg' ? r.outcome : undefined;
    if (!subjectKey || !ageBand || !sex || !indexDate || !outcome)
      throw new MdopError('E_RUNTIME', {}, `外部对照 ${side} 侧存在形状不完整行（拒绝执行）`);
    out.push({ subjectKey, ageBand, sex, indexDate, outcome } as ExternalControlRow);
  }
  return out;
}

/** 把执行器接到本节点的 wasm 算子实现上（装配点）。 */
export function registerNodeWasmOps(executor: MdopStageExecutor, deps: NodeWasmDeps): void {
  executor.setWasmRunner(createNodeWasmRunner(deps));
}

/**
 * 从阶段参数里取各参与方的投影。
 *
 * `params.parties` 是**宿主在派发阶段时按片段入边装配**的绑定（`{ref, node}`）：
 * `ref` 是信封解封后的投影引用，`node` 是持有方。参数缺失或输入对不上即拒——
 * 绝不按输入 Map 的遍历顺序猜谁是谁。
 */
function pairingTables(input: StageInput): PairPartyTable[] {
  const params = input.stage.params.parties;
  if (!Array.isArray(params) || params.length < 2)
    throw new MdopError(
      'E_RUNTIME',
      {},
      '配对阶段缺 parties 绑定（至少两方：{ref, node}）',
    );
  return (params as Array<{ ref?: unknown; node?: unknown }>).map((party, index) => {
    const ref = String(party?.ref ?? '');
    const node = String(party?.node ?? '');
    if (!ref || !node)
      throw new MdopError('E_RUNTIME', {}, `配对阶段第 ${index + 1} 个参与方缺 ref/node`);
    const projection = input.inputs.get(ref) as { rows?: PairPartyTable['rows'] } | undefined;
    if (!projection?.rows)
      throw new MdopError('E_RUNTIME', {}, `配对输入缺 ${ref} 的投影（未解封或引用不符）`);
    return { node, rows: projection.rows };
  });
}

/**
 * 从阶段参数里取去重人数的投影。
 *
 * `params.dataset` 是宿主装配的绑定（`{ref}` 或字符串 ref）：
 * 缺绑定或输入对不上即拒——绝不按输入 Map 的遍历顺序猜。
 */
function distinctCountRows(input: StageInput): DistinctCountRow[] {
  const raw = input.stage.params.dataset;
  const ref =
    typeof raw === 'string'
      ? raw
      : String((raw as { ref?: unknown } | undefined)?.ref ?? '');
  if (!ref)
    throw new MdopError('E_RUNTIME', {}, '去重人数阶段缺 dataset 绑定（{ref}）');
  const projection = input.inputs.get(ref) as { rows?: DistinctCountRow[] } | undefined;
  if (!projection?.rows)
    throw new MdopError('E_RUNTIME', {}, `去重人数输入缺 ${ref} 的投影（未解封或引用不符）`);
  return projection.rows;
}
