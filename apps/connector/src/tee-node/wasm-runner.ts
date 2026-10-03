import { MdopError } from '@medtrust/mdop';
import type { DistinctCountRow, PairPartyTable } from '@medtrust/wasm-algorithms';
import { WasmSandboxRunner } from '../domain/sandbox/sandbox-runner';
import type { MdopStageExecutor, StageInput, WasmRunner } from '../mdop/mdop-executor';
import {
  distinctCountFromSandboxOutput,
  distinctCountPayload,
  distinctCountRequiredBytes,
  projectDistinctCount,
} from '../mdop/node/distinct-count-sandbox';
import {
  projectScri,
  scriFromSandboxOutput,
  scriPayload,
  scriRequiredBytes,
} from '../mdop/node/scri-sandbox';
import {
  pairedCohortFromSandboxOutput,
  pairedCohortPayload,
  pairingRequiredBytes,
  projectPairing,
} from '../mdop/node/pairing-sandbox';

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
 *  - **对齐与分层留在宿主**：模块只认数字列，见 `mdop/node/pairing-sandbox.ts`
 *    与 `mdop/node/distinct-count-sandbox.ts`。
 */

/** 本节点实现（已接线到沙箱）的 wasm 算子。新增一种就在这里加一条，并在下面加分派。 */
export const NODE_WASM_OPS = {
  pairedCohort: 'rws.paired-cohort@1.0.0',
  distinctCount: 'rws.distinct-count@1.0.0',
  vaccineScri: 'rws.vaccine-scri@1.0.0',
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
}

const bare = (value: string): string => value.replace(/^sm3:/, '').toLowerCase();

/** 造一个可挂到 `MdopStageExecutor#setWasmRunner` 的执行器（只认本节点实现的那几个算子）。 */
export function createNodeWasmRunner(deps: NodeWasmDeps): WasmRunner {
  const runner = deps.runner ?? new WasmSandboxRunner();
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

    if (opRef === NODE_WASM_OPS.distinctCount) {
      return runDistinctCount({ runner, deps, input, moduleDigest, bytes });
    }
    if (opRef === NODE_WASM_OPS.vaccineScri) {
      return runVaccineScri({ runner, input, moduleDigest, bytes });
    }

    const tables = pairingTables(input);
    const projection = projectPairing({
      tables,
      ...(deps.strataKeys ? { strataKeys: deps.strataKeys } : {}),
    });
    runner.assertWithinMemoryLimit(
      pairingRequiredBytes({
        parties: projection.parties,
        subjects: projection.subjects,
        strata: projection.strata,
      }),
    );
    const result = await runner.run({
      analysisType: 'paired-cohort',
      moduleSm3: moduleDigest,
      moduleBytes: bytes,
      input: projection.input,
      // 配对模块是 5 参 ABI：参与方数与分层数必须显式给，形状错了会「算错而不是报错」
      abi: 'pairing@1',
      parties: projection.parties,
      n: projection.subjects,
      strata: projection.strata,
      k: projection.strata,
      outOff: projection.outOff,
      outBytes: projection.outBytes,
    });
    const paired = pairedCohortFromSandboxOutput({
      projection,
      output: result.output,
      parties: tables.map((t) => t.node),
    });
    return {
      // 等级不给：由**阶段声明**决定（模块无权给自己定等级），执行器会取 `stage.output_label`
      schema: input.stage.output_schema,
      payload: pairedCohortPayload(paired),
    };
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
  const projection = projectDistinctCount({
    rows,
    ...(deps.strataKeys ? { strataKeys: deps.strataKeys } : {}),
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
 * 疫苗接种后不良事件 SCRI。两方按**角色**绑定（`params.roles = {registry, events}` 给出持有方 URN），
 * 再与 `params.parties` 的 `{ref, node}` 对上——绝不按输入顺序猜谁是疾控、谁是医院。
 */
async function runVaccineScri(input: {
  runner: WasmSandboxRunner;
  input: StageInput;
  moduleDigest: string;
  bytes: Uint8Array;
}) {
  const { runner, input: stageInput, moduleDigest, bytes } = input;
  const params = stageInput.stage.params as Record<string, unknown>;
  const roles = (params.roles ?? {}) as { registry?: unknown; events?: unknown };
  const tables = pairingTables(stageInput);
  const byNode = (node: unknown) => {
    const table = tables.find((t) => t.node === node);
    if (!table) throw new MdopError('E_RUNTIME', {}, `SCRI 阶段找不到角色对应的输入：${String(node)}`);
    return table.rows as unknown[];
  };
  const window = (value: unknown, name: string): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isInteger))
      throw new MdopError('E_RUNTIME', {}, `SCRI 阶段参数 ${name} 必须是两个整数天`);
    return [value[0] as number, value[1] as number];
  };
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
  const projection = projectScri({
    registry: byNode(roles.registry) as never,
    events: byNode(roles.events) as never,
    windows: { risk: window(params.riskWindow, 'riskWindow'), control: window(params.controlWindow, 'controlWindow') },
    ...(list(params.vaccineCodes) ? { vaccineCodes: list(params.vaccineCodes) } : {}),
    ...(list(params.eventCodes) ? { eventCodes: list(params.eventCodes) } : {}),
    ...(list(params.strataKeys) ? { strataKeys: list(params.strataKeys) } : {}),
  });
  runner.assertWithinMemoryLimit(
    scriRequiredBytes({ pairs: projection.pairs, doses: projection.doses, strata: projection.strata }),
  );
  const result = await runner.run({
    analysisType: 'vaccine-scri',
    moduleSm3: moduleDigest,
    moduleBytes: bytes,
    input: projection.input,
    abi: 'scri@1',
    n: projection.pairs,
    k: projection.strata,
    outOff: projection.outOff,
    outBytes: projection.outBytes,
  });
  return {
    schema: stageInput.stage.output_schema,
    payload: scriPayload(scriFromSandboxOutput({ projection, output: result.output })),
  };
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
