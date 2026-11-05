/* eslint-disable no-console */
// 3.5  Local closed-loop demo. Proves the core thesis WITHOUT a control plane,
// TEE, or DB: a hospital connector ingests FHIR data, de-identifies it locally,
// runs an RWS signal-detection analysis, and emits ONLY an aggregate. Raw
// row-level data has no external exit and any attempt to read it is blocked.
//
// 批次 2 迁移（2026-10-14）：分析改走 **MDOP 阶段链**（本地投影 -> C2 节点内算子 -> C3 降密/发布审查），
// 不再经过旧通道的 RwsExecutor —— 叙述、步骤编号与输出结构不变。
//
// Run: pnpm --filter @medtrust/connector demo
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { AlignmentLinker, resolveAlignmentConfig } from '../domain/alignment/alignment-linker';
import { FhirGateway } from '../domain/fhir-gateway';
import { LocalStore, RawAccessDeniedError } from '../domain/local-store';
import { aeSignalProjection } from '../mdop/operators/seal';
import { NODE_WASM_OPS } from '../tee-node/wasm-runner';
import { mockHospitalBundle } from './mock-fhir';
import { runSingleHolder } from './mdop-demo-support';

async function main() {
  const audit = new AuditService();
  const gateway = new FhirGateway();
  const deid = new Deidentifier();
  const store = new LocalStore(audit);

  console.log('\n=== 示范甲医院连接器  本地闭环演示 ===\n');

  const bundle = mockHospitalBundle(7, 40);
  const raw = gateway.fromBundle(bundle);
  // 单院闭环：`subjectKey` 就够（不跨院）。跨院产品的 `linkKey` 才需要共管密钥派生 ——
  // 这里顺带把派生器建起来，配了密钥就一起演示，没配就跳过（不拿 subjectKey 冒充）。
  const alignment = new AlignmentLinker(resolveAlignmentConfig(), audit);
  const internal = raw.map((r) => alignment.attach(deid.deidentify(r), r.patientId));
  store.ingest(internal);
  console.log(`1. 接入并脱敏:${raw.length} 名患者  本地存储 ${store.count()} 条(已去除姓名/电话/身份证/精确生日)`);
  console.log(
    `   跨院对齐键:${alignment.enabled ? `已启用 kid=${alignment.kid()}` : '未配置（跨院产品不会出域，符合预期）'}`,
  );

  let blocked = false;
  try {
    store.exportRaw({ origin: 'external', actor: '创新药企' });
  } catch (e) {
    blocked = e instanceof RawAccessDeniedError;
  }
  console.log(`2. 外部尝试读取行级原始数据:${blocked ? '已拒绝 (数据不出域)' : '未拒绝 '}`);

  const projected = aeSignalProjection(
    {
      rows: internal.map((r) => ({
        subjectKey: r.subjectKey,
        ...(r.linkKey ? { linkKey: r.linkKey } : {}),
        adverseEvents: r.adverseEvents,
        medications: r.medications,
      })),
    },
    'adverseEvents',
  );
  const { c3, label } = await runSingleHolder({
    jobId: 'demo-local-loop',
    wasmOp: NODE_WASM_OPS.categoricalCount,
    moduleAnalysisType: 'categorical-count',
    manifestId: 'rws.categorical-count',
    schema: 'rws.categorical-count/1.0',
    params: {
      categoryKeys: [
        ...new Set((projected.rows as Array<{ category: string }>).map((r) => r.category)),
      ].sort(),
    },
    holder: { node: 'urn:tds:sh-med:participant:demo-hospital', envelope: projected },
    minCell: 5,
  });
  const events = Number(c3.rowCount ?? projected.n);
  const patients = Number(c3.recordCount ?? events);
  const buckets = (c3.buckets ?? []) as Array<{ key: string; count: number }>;
  console.log(`3. MDOP 阶段链（C2 节点内算子 -> C3 ${label}）队列 ${patients} 人 / 事件 ${events} 起，出域:`);
  for (const b of buckets) {
    const rate = events > 0 ? (b.count / events) * 100 : 0;
    console.log(`      ${b.key}: ${b.count} 起 (占比 ${rate.toFixed(1)}%)`);
  }
  console.log('      （低于 minCell=5 的单元格已在 C3 降密阶段按合同条件抑制）');

  const leaks = deid.containsDirectIdentifier(c3);
  console.log(`4. 出域内容含行级标识符:${leaks ? '是 ' : '否 '}`);

  console.log('\n--- 审计 ---');
  for (const e of audit.all()) {
    console.log(`   [${e.allowed ? 'OK ' : 'DENY'}] ${e.action}  ${e.actor}${e.detail ? '  ' + e.detail : ''}`);
  }
  console.log(`\n原始数据出域行数:0    仅 1 个聚合对象离开连接器\n`);

  if (!blocked || leaks) process.exit(1);
}

void main();
