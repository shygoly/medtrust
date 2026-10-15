/**
 * D10.4 验收：**本地**（无控制面）也能跑 L1.5 —— 模块取复现构建清单、自签信任根、
 * 数据取本地库回调内；结果与 `retained: test-reference` 的独立参考实现 `disproportionalityTables` 逐字段一致。
 */
import * as fs from 'fs';
import * as path from 'path';
import { AuditService } from '../domain/audit';
import { LocalStore } from '../domain/local-store';
import { disproportionalityTables } from '../domain/rws-executor';
import { MdopStageExecutor } from '../mdop/mdop-executor';
import { registerLocalL15 } from './local-l15-wiring';

const DRUG = 'MEM';
const MODULE_DIR = path.resolve(__dirname, '../../../../packages/wasm-algorithms/build');

function rows() {
  const mk = (organ: string, term: string) => ({
    subjectKey: 'sk_' + Math.random(),
    ageBand: '40-49',
    conditions: [],
    medications: [DRUG],
    adverseEvents: [{ organSystem: organ, term, serious: false }],
  });
  return [
    mk('肝胆系统', 'ALT'),
    mk('肝胆系统', 'AST'),
    mk('血液系统', 'WBC'),
    mk('胃肠系统', 'N'),
    mk('神经系统', 'D'),
  ];
}

describe('本地 L1.5 装配（D10.4）', () => {
  it('source -> rws.disproportionality 走本地模块客户端，结果与参照实现一致', async () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(MODULE_DIR, 'manifest.json'), 'utf8'),
    ) as { modules: Array<{ analysisType: string; sm3: string }> };
    const sm3 = manifest.modules.find((m) => m.analysisType === 'disproportionality')!.sm3;
    const store = new LocalStore(new AuditService());
    store.ingest(rows() as never);
    const executor = new MdopStageExecutor();
    registerLocalL15(executor, { store, moduleDir: MODULE_DIR });

    const src = await executor.execute(
      {
        jobId: 'j1',
        stage: {
          id: 'src',
          node: 'n1',
          op: 'source.dataset@1.0.0',
          op_digest: 'component:connector-datasource@1',
          params: { uri: 'ds://n1/dp' },
          inputs: [],
          input_labels: [],
          output_label: 'C0',
          output_schema: 'mdop.dataset/1.0',
        },
        inputs: new Map(),
        attempt: 1,
      } as never,
      {
        apiVersion: 'mdop/v1',
        kind: 'system',
        id: 'source.dataset',
        version: '1.0.0',
        category: 'source',
        digest: 'component:connector-datasource@1',
        publisher: 'urn:t',
        inputs: [],
        outputs: [],
        params: {},
        environments: ['tee'],
        security: { network: 'none' },
        component: 'connector-datasource@1.0.0',
      } as never,
    );
    expect((src.payload as { n: number }).n).toBe(5);

    const l15 = await executor.execute(
      {
        jobId: 'j1',
        stage: {
          id: 'l15',
          node: 'n1',
          op: 'rws.disproportionality@1.0.0',
          op_digest: `sm3:${sm3}`,
          params: { drug: DRUG },
          inputs: [{ from: 'src' }],
          input_labels: ['C0'],
          output_label: 'C2',
          output_schema: 'rws.disproportionality/1.0',
        },
        inputs: new Map([['src', src.payload]]),
        attempt: 1,
      } as never,
      {
        apiVersion: 'mdop/v0.2',
        kind: 'wasm',
        id: 'rws.disproportionality',
        version: '1.0.0',
        category: 'local',
        digest: `sm3:${sm3}`,
        publisher: 'urn:tds:platform',
        inputs: [],
        outputs: [{ name: 'o', schema: 'mdop.table/1.0', label_rule: 'inherit' }],
        params: {},
        environments: ['plain'],
        security: { network: 'none' },
        build: { source_digest: `sm3:${sm3}`, toolchain: 'asc@0.27.37', reproducible: true },
      } as never,
    );

    const builtIn = disproportionalityTables(rows() as never, DRUG);
    const got = (l15.payload as { buckets: Array<{ key: string; count: number; b: number; c: number; d: number }> }).buckets;
    expect(got.map((b) => [b.key, b.count, b.b, b.c, b.d])).toEqual(
      builtIn.buckets.map((b) => [b.key, b.count, b.b, b.c, b.d]),
    );
  });
});
