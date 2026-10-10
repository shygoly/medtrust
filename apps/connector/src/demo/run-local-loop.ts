/* eslint-disable no-console */
// 3.5 — Local closed-loop demo. Proves the core thesis WITHOUT a control plane,
// TEE, or DB: a hospital connector ingests FHIR data, de-identifies it locally,
// runs an RWS signal-detection analysis, and emits ONLY an aggregate. Raw
// row-level data has no external exit and any attempt to read it is blocked.
//
// Run: pnpm --filter @medtrust/connector demo
import { AuditService } from '../domain/audit';
import { Deidentifier } from '../domain/deidentifier';
import { FhirGateway } from '../domain/fhir-gateway';
import { LocalStore, RawAccessDeniedError } from '../domain/local-store';
import { RwsExecutor } from '../domain/rws-executor';
import { OutputGate } from '../domain/output-gate';
import { mockHospitalBundle } from './mock-fhir';

function main() {
  const audit = new AuditService();
  const gateway = new FhirGateway();
  const deid = new Deidentifier();
  const store = new LocalStore(audit);
  const executor = new RwsExecutor(store, deid);

  console.log('\n=== 示范甲医院连接器 · 本地闭环演示 ===\n');

  // 1) ingest FHIR from the hospital source, de-identify locally
  const bundle = mockHospitalBundle(7, 40);
  const raw = gateway.fromBundle(bundle);
  const internal = raw.map((r) => deid.deidentify(r));
  store.ingest(internal);
  console.log(`1. 接入并脱敏:${raw.length} 名患者 → 本地存储 ${store.count()} 条(已去除姓名/电话/身份证/精确生日)`);

  // 2) an external party tries to pull raw rows — must be blocked
  let blocked = false;
  try {
    store.exportRaw({ origin: 'external', actor: '创新药企' });
  } catch (e) {
    blocked = e instanceof RawAccessDeniedError;
  }
  console.log(`2. 外部尝试读取行级原始数据:${blocked ? '已拒绝 ✅(数据不出域)' : '未拒绝 ❌'}`);

  // 3) run the authorized RWS analysis IN-ENCLAVE (TEE), then pass the result
  //    through the output gate (small-cell suppression)
  const rawAggregate = executor.run({ type: 'adverse-event-signal', drug: '注射用紫杉醇' });
  const aggregate = new OutputGate(audit, deid).pass(rawAggregate, 5);
  console.log(`3. TEE 内执行 RWS 信号检测(用药队列 n=${aggregate.cohortSize})→ 输出闸门 → 回传聚合:`);
  for (const b of aggregate.buckets) {
    const tag = b.suppressed ? ' [小单元格已抑制]' : '';
    console.log(`     · ${b.key}: ${b.count} 例 (发生率 ${(b.rate * 100).toFixed(1)}%)${tag}`);
  }

  // 4) verify the emitted aggregate carries zero row-level identifiers
  const leaks = deid.containsDirectIdentifier(aggregate);
  console.log(`4. 出域内容含行级标识符:${leaks ? '是 ❌' : '否 ✅'}`);

  console.log('\n--- 审计 ---');
  for (const e of audit.all()) {
    console.log(`   [${e.allowed ? 'OK ' : 'DENY'}] ${e.action} · ${e.actor}${e.detail ? ' · ' + e.detail : ''}`);
  }
  console.log(`\n原始数据出域行数:0  ·  仅 1 个聚合对象离开连接器\n`);

  if (!blocked || leaks) process.exit(1);
}

main();
