// 编排：规格不可用/降级/回执不符 → 任务失败，且**绝不**退回内置弱脱敏（design §7）。
import {
  deidSpecSignaturePayload,
  generateSm2KeyPair,
  publicKeyFromPrivateKey,
  publicKeyKid,
  sm2Sign,
  type DeidSpec,
} from '@medtrust/mdop';
import { stableStringify } from '../canonical-json';
import { sm3Hex } from '../sm3';
import type { ContractView } from '../contract-view';
import { AgentDeidClient, type AgentDeidRunInput } from './agent-deid-client';
import {
  DeidReceiptMismatch,
  DeidRunner,
  digestRows,
  verifyReceipt,
} from './deid-runner';
import { DeidSpecRejected, DeidSpecStore, type SignedDeidSpec } from './spec-package';

const KEYS = generateSm2KeyPair();
const PUB = KEYS.publicKey;

function spec(): DeidSpec {
  return {
    version: 1,
    id: 'deid.ckd.v3',
    scope: { product: 'urn:tds:sp:ckd-cohort', level: 'C0_internal' },
    transforms: [
      { field: 'patientId', op: 'hmac_pseudonym', params: { saltRef: 'hosp-kms:ckd', outLen: 16 } },
      { field: 'name', op: 'drop' },
      { field: 'labValue', op: 'keep' },
    ],
    quasiIdentifierPolicy: { k: 5, suppressIfBelow: true, columns: ['ageBand'] },
    denyIfTransformMissing: ['patientId', 'name'],
  };
}

function pkg(over: Partial<SignedDeidSpec> = {}): SignedDeidSpec {
  const specJson = stableStringify(spec());
  const specSm3 = sm3Hex(specJson);
  return {
    specId: 'deid.ckd.v3',
    version: 1,
    specJson,
    specSm3,
    signature: sm2Sign(deidSpecSignaturePayload(specSm3), KEYS.privateKey, {
      publicKey: publicKeyFromPrivateKey(KEYS.privateKey),
    }),
    keyId: publicKeyKid(PUB),
    issuedAt: new Date(Date.now() - 1000).toISOString(),
    notAfter: new Date(Date.now() + 86_400_000).toISOString(),
    signaturePayload: deidSpecSignaturePayload(specSm3),
    ...over,
  };
}

const contract = (over: Partial<ContractView['deid']> = {}): ContractView => ({
  id: 'c-1',
  dataProductId: 'urn:tds:sp:ckd-cohort',
  purpose: 'rws',
  retention: '阅后即焚',
  output: '聚合',
  minCell: 5,
  validUntil: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'active',
  deid: {
    specId: 'deid.ckd.v3',
    pseudonymFields: ['patientId'],
    mandatoryFields: ['patientId', 'name'],
    ...over,
  },
});

const ROWS = [
  { patientId: 'p-1', name: '张三', labValue: 7 },
  { patientId: 'p-2', name: '李四', labValue: 9 },
];

/** 假 agent：把脱敏结果与回执都按真实口径算出来（便于逐项篡改做负例）。 */
class FakeAgent extends AgentDeidClient {
  constructor(private readonly options: { tamper?: 'input' | 'output' | 'spec' | 'rows' | 'ack' } = {}) {
    super('127.0.0.1:1');
  }

  override async run(input: AgentDeidRunInput) {
    const rows = input.rows.map((row) => ({
      ...(row as Record<string, unknown>),
      patientId: `sk_${String(row.patientId).slice(-2).padStart(2, '0')}`,
    }));
    for (const row of rows) delete (row as Record<string, unknown>).name;
    const specObj = JSON.parse(stableStringify(input.spec)) as DeidSpec;
    const specSm3 = sm3Hex(stableStringify(specObj));
    const outputBytes = Buffer.from(rows.map((r) => `${stableStringify(r)}\n`).join(''), 'utf8');
    return {
      rows: this.options.tamper === 'rows' ? [...rows, { patientId: 'sk_99' }] : rows,
      outputSm3: sm3Hex(outputBytes.toString('utf8')),
      receipt: {
        ackStatus: this.options.tamper === 'ack' ? 'FAILED' : 'OK',
        rowCount: rows.length,
        inputDigest:
          this.options.tamper === 'input' ? 'f'.repeat(64) : digestRows(input.rows),
        outputDigest:
          this.options.tamper === 'output' ? 'e'.repeat(64) : sm3Hex(outputBytes.toString('utf8')),
        specSm3: this.options.tamper === 'spec' ? 'd'.repeat(64) : specSm3,
        agentReceipt: 'a'.repeat(64),
        warnings: [],
        message: 'ok',
      },
    };
  }
}

function runner(
  agent: AgentDeidClient,
  options: { mode?: 'builtin' | 'agent'; loadSpec?: boolean; audit?: { record: jest.Mock } } = {},
) {
  const store = new DeidSpecStore();
  if (options.loadSpec !== false) store.applyPackages([pkg()], PUB);
  return new DeidRunner(
    store,
    agent,
    options.audit as never,
    options.mode ?? 'agent',
  );
}

describe('DeidRunner.run', () => {
  it('规格/回执都对 → 返回脱敏块并落审计', async () => {
    const audit = { record: jest.fn() };
    const result = await runner(new FakeAgent(), { audit }).run({
      jobId: 'j-1',
      contract: contract(),
      rows: ROWS,
      saltRef: 'hosp-kms:ckd',
    });
    expect(result.rows).toHaveLength(2);
    expect(result.specId).toBe('deid.ckd.v3');
    expect(result.rows.every((row) => String(row.patientId).startsWith('sk_'))).toBe(true);
    expect(result.rows.every((row) => !('name' in row))).toBe(true);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][0].action).toBe('deid-agent-run');
  });

  it('builtin 模式不走本通道（返回明确错误，而不是悄悄自脱敏）', async () => {
    await expect(
      runner(new FakeAgent(), { mode: 'builtin' }).run({
        jobId: 'j-1',
        contract: contract(),
        rows: ROWS,
        saltRef: 'hosp-kms:ckd',
      }),
    ).rejects.toThrow(/CONNECTOR_DEID_MODE=builtin/);
  });

  it('本地没有可用规格 → SPEC_NOT_AVAILABLE（不兜底）', async () => {
    await expect(
      runner(new FakeAgent(), { loadSpec: false }).run({
        jobId: 'j-1',
        contract: contract(),
        rows: ROWS,
        saltRef: 'hosp-kms:ckd',
      }),
    ).rejects.toBeInstanceOf(DeidSpecRejected);
  });

  it('合约没绑脱敏条款 → 拒', async () => {
    await expect(
      runner(new FakeAgent()).run({
        jobId: 'j-1',
        contract: { ...contract(), deid: undefined },
        rows: ROWS,
        saltRef: 'hosp-kms:ckd',
      }),
    ).rejects.toThrow(/SPEC_SCOPE_MISMATCH/);
  });

  it('降级（合约要求假名，规格把 patientId 写成 keep）→ 拒，且未调用 agent', async () => {
    const store = new DeidSpecStore();
    const downgraded = { ...spec() };
    downgraded.transforms = downgraded.transforms.map((t) =>
      t.field === 'patientId' ? { field: 'patientId', op: 'keep' } : t,
    );
    const specJson = stableStringify(downgraded);
    const specSm3 = sm3Hex(specJson);
    store.applyPackages(
      [
        {
          ...pkg(),
          specJson,
          specSm3,
          signature: sm2Sign(deidSpecSignaturePayload(specSm3), KEYS.privateKey, {
            publicKey: publicKeyFromPrivateKey(KEYS.privateKey),
          }),
          signaturePayload: deidSpecSignaturePayload(specSm3),
        },
      ],
      PUB,
    );
    const agent = new FakeAgent();
    const spy = jest.spyOn(agent, 'run');
    await expect(
      new DeidRunner(store, agent, undefined, 'agent').run({
        jobId: 'j-1',
        contract: contract(),
        rows: ROWS,
        saltRef: 'hosp-kms:ckd',
      }),
    ).rejects.toThrow(/DIRECT_IDENTIFIER_KEPT/);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['input', /输入摘要不符/],
    ['output', /输出摘要不符/],
    ['spec', /规格摘要不符/],
    ['rows', /行数不符/],
    ['ack', /ack=FAILED/],
  ] as const)('回执被篡改（%s）→ 拒', async (tamper, pattern) => {
    await expect(
      runner(new FakeAgent({ tamper })).run({
        jobId: 'j-1',
        contract: contract(),
        rows: ROWS,
        saltRef: 'hosp-kms:ckd',
      }),
    ).rejects.toThrow(pattern);
  });
});

describe('verifyReceipt', () => {
  const base = {
    receipt: {
      ackStatus: 'OK',
      rowCount: 1,
      inputDigest: 'a'.repeat(64),
      outputDigest: 'b'.repeat(64),
      specSm3: 'c'.repeat(64),
      agentReceipt: 'd'.repeat(64),
      warnings: [],
      message: 'ok',
    },
    specSm3: 'c'.repeat(64),
    inputDigest: 'a'.repeat(64),
    outputDigest: 'b'.repeat(64),
    rowCount: 1,
  };

  it('全对 → 通过', () => {
    expect(() => verifyReceipt(base)).not.toThrow();
  });

  it('agent_receipt 为空 → 拒（不能没有留痕凭据）', () => {
    expect(() =>
      verifyReceipt({ ...base, receipt: { ...base.receipt, agentReceipt: '' } }),
    ).toThrow(DeidReceiptMismatch);
  });
});

describe('digestRows', () => {
  it('逐行规范化拼接（与 agent 侧同口径）', () => {
    const rows = [{ b: 1, a: 'x' }];
    expect(digestRows(rows)).toBe(sm3Hex('{"a":"x","b":1}\n'));
  });
});
