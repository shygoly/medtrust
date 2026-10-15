/* eslint-disable no-console */
/**
 * demo 用的 **MDOP 节点侧执行助手**（批次 2 迁移的一部分）。
 *
 * 各 demo 原先直接用 `RwsExecutor`（旧通道）。删旧接线的前提是**新接线完成** ——
 * demo 必须走 MDOP 阶段链。本文件把样板（wasm 清单 + 节点算子注册 + 发布审查 + C2/C3）抽一次，
 * 各 demo 只需换成一次 `runSingleHolder` 调用，叙述与输出保持不变。
 * 范式来源：`run-rws-scenarios-e2e.ts`。
 */
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { OutputGate } from '../domain/output-gate';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { NodePublicationReview } from '../mdop/node/publication-review';
import { NODE_DECLASSIFY_OP, registerNodeDeclassifyOperator } from '../tee-node/declassify-op';
import { registerNodeWasmOps } from '../tee-node/wasm-runner';

const REPO = path.resolve(__dirname, '../../../..');
const BUILD = path.join(REPO, 'packages/wasm-algorithms/build');

interface ManifestEntry {
  analysisType: string;
  file: string;
  sm3: string;
  abiVersion: number;
}

export function moduleOf(analysisType: string): { bytes: Uint8Array; entry: ManifestEntry } {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(BUILD, 'manifest.json'), 'utf8'),
  ) as { modules: ManifestEntry[] };
  const entry = manifest.modules.find((m) => m.analysisType === analysisType);
  if (!entry) throw new Error(`清单里没有模块：${analysisType}`);
  const bytes = fs.readFileSync(path.join(BUILD, entry.file));
  if (process.env.MDOP_DEMO_DEBUG)
    console.log(
      `[debug] moduleOf(${analysisType}) file=${entry.file} bytes=${bytes.length} head=${Buffer.from(bytes.subarray(0, 8)).toString('hex')} isBuffer=${Buffer.isBuffer(bytes)} sm3=${entry.sm3.slice(0, 12)}`,
    );
  return { bytes, entry };
}

const wasmManifest = (id: string, digest: string, schema: string, inputNames: string[]) => ({
  apiVersion: 'mdop/v1',
  kind: 'wasm',
  id,
  version: '1.0.0',
  category: 'local',
  digest,
  publisher: 'urn:tds:sh-med:operator-registry',
  inputs: inputNames.map((name) => ({ name, schema: 'mdop.projection/1.0', accept_labels: ['C2'] })),
  outputs: [{ name: id.replace('rws.', ''), schema, label_rule: 'inherit' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  build: { source_digest: `sm3:${'a'.repeat(64)}`, toolchain: 'asc@0.27.37', reproducible: true },
});

const systemManifest = (schema: string) => ({
  apiVersion: 'mdop/v1',
  kind: 'system',
  id: 'declassify.small_cell',
  version: '1.0.0',
  category: 'declassify',
  digest: 'component:node-publication-review@1',
  publisher: 'urn:tds:platform',
  inputs: [{ name: 'in', schema, accept_labels: ['C2'] }],
  outputs: [{ name: 'out', schema, label_rule: 'C3' }],
  params: {},
  environments: ['tee'],
  security: { network: 'none' },
  component: 'node-publication-review@1.0.0',
});

export async function runSingleHolder(options: {
  jobId: string;
  wasmOp: string;
  moduleAnalysisType: string;
  manifestId: string;
  schema: string;
  params: Record<string, unknown>;
  holder: { node: string; envelope: unknown };
  minCell?: number;
}): Promise<{ c2: Record<string, unknown>; c3: Record<string, unknown>; label: string }> {
  const minCell = options.minCell ?? 5;
  const mod = moduleOf(options.moduleAnalysisType);
  const executor = new MdopStageExecutor();
  let calls = 0;
  registerNodeWasmOps(executor, {
    moduleBytes: (digest) => {
      calls += 1;
      const hit = digest === mod.entry.sm3;
      if (process.env.MDOP_DEMO_DEBUG)
        console.log(
          `[debug] moduleBytes#${calls} digest=${String(digest).slice(0, 12)} hit=${hit} bytes=${hit ? mod.bytes.length : 0} head=${hit ? Buffer.from(mod.bytes.subarray(0, 8)).toString('hex') : ''}`,
        );
      return hit ? mod.bytes : undefined;
    },
  });
  const review = new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier()));
  registerNodeDeclassifyOperator(executor, {
    review,
    contractTerms: () => ({ publication: { minCell } }),
  });

  const c2 = await executor.execute(
    {
      jobId: options.jobId,
      stage: {
        id: 'op',
        node: options.holder.node,
        op: options.wasmOp,
        op_digest: `sm3:${mod.entry.sm3}`,
        params: { dataset: { ref: 'rows' }, ...options.params },
        inputs: [{ from: 'rows' }],
        input_labels: ['C2'],
        output_label: 'C2',
        output_schema: options.schema,
      },
      inputs: new Map([['rows', options.holder.envelope]]),
      attempt: 1,
    } as never,
    wasmManifest(options.manifestId, `sm3:${mod.entry.sm3}`, options.schema, ['rows']) as never,
  );

  const c3 = await executor.execute(
    {
      jobId: options.jobId,
      stage: {
        id: 'dec',
        node: options.holder.node,
        op: NODE_DECLASSIFY_OP,
        op_digest: 'component:node-publication-review@1',
        params: { contractId: 'c-demo', minCell },
        inputs: [{ from: 'op' }],
        input_labels: ['C2'],
        output_label: 'C3',
        output_schema: options.schema,
      },
      inputs: new Map([['op', c2.payload as unknown]]),
      attempt: 1,
    } as never,
    systemManifest(options.schema) as never,
  );

  return {
    c2: c2.payload as Record<string, unknown>,
    c3: c3.payload as Record<string, unknown>,
    label: c3.label as string,
  };
}
