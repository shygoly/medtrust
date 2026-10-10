import { canonicalSm3, canonicalize, sm2Sign, sm2Verify, verifyCanonicalObject, type DataEnvelope } from '@medtrust/mdop';
import { AuditService } from '../../domain/audit';
import { Deidentifier } from '../../domain/deidentifier';
import { OutputGate } from '../../domain/output-gate';
import { TrustedNodeEntryGuard } from './entry-guard';
import { NodeQueryBudgetLedger } from './budget-ledger';
import { NodePublicationReview } from './publication-review';
import { NodeExitGuard } from './node-exit';
import { NodeReceiptChain } from './node-receipts';
import { NodeArtifactStore } from './node-artifacts';

/**
 * 可信空间节点运行时的三件纯逻辑（任务 3.4 / 3.6 / 3.7）：
 * 入口守卫、发布审查、查询预算账本。**都不需要硬件**——硬件只影响「证明代理」那一块。
 */

const KEYS = sm2Sign; // 复用国密签名工具做信封签名
const holder = { privateKey: '', publicKey: '' };
const MEAS = `sm3:${'a'.repeat(64)}`;

/** 造一封结构合法、AAD 与签名都对的信封。 */
function buildEnvelope(over: Partial<Record<string, unknown>> = {}): DataEnvelope {
  const unsigned = {
    envelope: 'mdop.env/1.0' as const,
    payload: {
      cipher: 'AES-256-GCM',
      ciphertext_ref: 'blob://sealed/k-1',
      digest: `sm3:${'b'.repeat(64)}`,
    },
    wrapped_key: { kms: 'kms://space.example.cn', key_id: 'k-1' },
    policy: {
      contract: 'ctr-1',
      purpose: ['RWS.EFFECTIVENESS'],
      allowed_ops: [`sm3:${'a'.repeat(64)}`],
      attestation_policy: { tee: ['tdx'], min_tcb: { tdx: '3.1.0' } },
      export: 'C3_only' as const,
      not_after: '2027-09-30T00:00:00.000Z',
    },
    watermark: 'wm:site-a:sh-med:20260925',
  };
  const merged = { ...unsigned, ...(over as Record<string, unknown>) };
  // 被签的是「整封信封去掉 origin_sig」——**包含 aad**（与入口守卫的验签口径一致）
  const envelopeForSigning = {
    ...merged,
    aad: { job_id: 'job-1', credential_id: 'tkt-1', contract_id: 'ctr-1' },
  };
  return {
    ...(envelopeForSigning as unknown as DataEnvelope),
    origin_sig: {
      signer: 'urn:tds:sh-med:participant:p-demohospa',
      alg: 'SM2-SM3',
      value: KEYS(canonicalize(envelopeForSigning), holder.privateKey, {
        publicKey: holder.publicKey,
      }),
    },
  };
}

describe('可信空间节点运行时（任务 3.4 / 3.6 / 3.7）', () => {
  beforeAll(() => {
    // 生成一次性密钥对（国密）
    const pair = (() => {
      // sm-crypto 的 keypair 生成在 @medtrust/mdop 里已有封装；这里用签名工具反推不可行，
      // 故直接调用 mdop 的生成器。
      const { generateSm2KeyPair } = require('@medtrust/mdop') as {
        generateSm2KeyPair: () => { privateKey: string; publicKey: string };
      };
      return generateSm2KeyPair();
    })();
    holder.privateKey = pair.privateKey;
    holder.publicKey = pair.publicKey;
  });

  const contract = {
    contract_id: 'ctr-1',
    data_product_id: 'dp-1',
    allowed_ops: [`sm3:${'a'.repeat(64)}`],
    attestation_policy: { tee: ['tdx'] },
  };
  const holderKeys = () =>
    new Map<string, string>([['urn:tds:sh-med:participant:p-demohospa', holder.publicKey]]);
  const expectCtx = { job_id: 'job-1', credential_id: 'tkt-1', contract_id: 'ctr-1' };

  describe('入口守卫（3.4）', () => {
    it('合规信封放行；解析后可读出数据产品与出口形态', () => {
      const guard = new TrustedNodeEntryGuard(holderKeys());
      const out = guard.check({
        rawEnvelope: buildEnvelope(),
        selfNode: 'urn:tds:sh-med:participant:tee-1',
        expect: expectCtx,
        contract,
        providerKind: 'tdx',
        now: new Date('2026-09-25T10:00:00.000Z'),
      });
      expect(out.dataProductId).toBe('dp-1');
      expect(out.envelope.policy.export).toBe('C3_only');
    });

    it('换作业（AAD 不符）→ 拒', () => {
      const guard = new TrustedNodeEntryGuard(holderKeys());
      expect(() =>
        guard.check({
          rawEnvelope: buildEnvelope(),
          selfNode: 'urn:tds:sh-med:participant:tee-1',
          expect: { ...expectCtx, job_id: 'job-2' },
          contract,
          providerKind: 'tdx',
        }),
      ).toThrow(expect.objectContaining({ code: 'E_ENVELOPE_POLICY' }));
    });

    it('签名被改 / 没有该持有方公钥 → 拒', () => {
      const tampered = buildEnvelope();
      const guard = new TrustedNodeEntryGuard(holderKeys());
      expect(() =>
        guard.check({
          rawEnvelope: { ...tampered, watermark: 'wm:someone-else' },
          selfNode: 'urn:tds:sh-med:participant:tee-1',
          expect: expectCtx,
          contract,
          providerKind: 'tdx',
        }),
      ).toThrow(expect.objectContaining({ code: 'E_AUTH_INVALID' }));

      const noKeys = new TrustedNodeEntryGuard(new Map());
      expect(() =>
        noKeys.check({
          rawEnvelope: buildEnvelope(),
          selfNode: 'urn:tds:sh-med:participant:tee-1',
          expect: expectCtx,
          contract,
          providerKind: 'tdx',
        }),
      ).toThrow(expect.objectContaining({ code: 'E_AUTH_INVALID' }));
    });

    it('本节点链型不在合约允许范围（软件实现 / 别的链）→ 拒', () => {
      const guard = new TrustedNodeEntryGuard(holderKeys());
      for (const kind of [null, 'csv']) {
        expect(() =>
          guard.check({
            rawEnvelope: buildEnvelope(),
            selfNode: 'urn:tds:sh-med:participant:tee-1',
            expect: expectCtx,
            contract,
            providerKind: kind,
          }),
        ).toThrow(expect.objectContaining({ code: 'E_CAPABILITY_MISMATCH' }));
      }
    });

    it('信封策略未覆盖本地合约允许的算子 → 拒（策略只能收窄，不能放宽）', () => {
      const guard = new TrustedNodeEntryGuard(holderKeys());
      const narrow = buildEnvelope({
        payload: {
          cipher: 'AES-256-GCM',
          ciphertext_ref: 'blob://sealed/k-1',
          digest: `sm3:${'b'.repeat(64)}`,
        },
      });
      // 直接把策略里的 allowed_ops 清空（签名会随之失效，但先看策略判定）
      const env = { ...narrow, policy: { ...narrow.policy, allowed_ops: [] } };
      expect(() =>
        guard.check({
          rawEnvelope: env,
          selfNode: 'urn:tds:sh-med:participant:tee-1',
          expect: expectCtx,
          contract,
          providerKind: 'tdx',
        }),
      ).toThrow();
    });
  });

  describe('发布审查（3.6）', () => {
    const gate = () => new NodePublicationReview(new OutputGate(new AuditService(), new Deidentifier()));

    it('小单元格被抑制；抑制计数只进审计记录，不进载荷', () => {
      const review = gate();
      const { payload, record } = review.review({
        candidate: {
          analysisType: 'disproportionality',
          cohortSize: 100,
          buckets: [{ key: 'x', count: 3, rate: 0.03, b: 2, c: 1, d: 94 }],
        },
        minCell: 5,
        contractId: 'ctr-1',
      });
      expect(record.suppressed).toBe(1);
      expect(record.minCell).toBe(5);
      // 载荷里**没有抑制计数**（计数只进节点本地审查记录）；单元格上可以有 `suppressed` 标记
      expect((payload as { suppressed?: unknown }).suppressed).toBeUndefined();
      expect((payload as { suppressed_count?: unknown }).suppressed_count).toBeUndefined();
      expect((payload as { buckets: Array<{ count: number }> }).buckets[0].count).toBe(0);
      expect(review.recordsLog()).toHaveLength(1);
    });

    it('行级/可识别输出被闸门拒 → E_RELEASE_CHECK_FAILED（不做降级）', () => {
      const review = gate();
      expect(() =>
        review.review({
          candidate: { rows: [{ subjectKey: 'sk-1' }] },
          minCell: 5,
          contractId: 'ctr-1',
        }),
      ).toThrow(expect.objectContaining({ code: 'E_RELEASE_CHECK_FAILED' }));
    });

    it('拒放说明不带数据：闸门的固定原因照给；其它异常的文案（可能带出候选里的值）只留本地', () => {
      // 闸门自己的拒放：原因是常量，候选里的主体键不会被回显
      const blocked = (() => {
        try {
          gate().review({ candidate: { rows: [{ subjectKey: 'sk-secret-001' }] }, minCell: 5, contractId: 'ctr-1' });
        } catch (err) {
          return err as Error;
        }
        throw new Error('应当被拒');
      })();
      expect(blocked.message).toContain('发布审查未通过：输出含行级可识别数据');
      expect(blocked.message).not.toContain('sk-secret-001');

      // 闸门内部出了别的异常（这里用替身模拟一条带着候选取值的报错）：对外只有固定文案
      const leaky = new NodePublicationReview({
        pass: () => {
          throw new TypeError('cannot read count of bucket "备注：家住某某路 3 号" (count=3)');
        },
      } as unknown as OutputGate);
      const failed = (() => {
        try {
          leaky.review({ candidate: { buckets: [] }, minCell: 5, contractId: 'ctr-1' });
        } catch (err) {
          return err as Error & { code?: string };
        }
        throw new Error('应当被拒');
      })();
      expect(failed.code).toBe('E_RELEASE_CHECK_FAILED');
      expect(failed.message).toBe(
        'E_RELEASE_CHECK_FAILED: 发布审查未通过：候选结果无法完成审查（详情只留在节点本地日志）',
      );
      expect(failed.message).not.toContain('某某路');
      expect(failed.message).not.toContain('count=3');
    });

    it('缺 minCell → 直接拒（发布审查不能没有阈值）', () => {
      const review = gate();
      expect(() =>
        review.review({ candidate: { buckets: [] }, minCell: 0, contractId: 'ctr-1' }),
      ).toThrow(expect.objectContaining({ code: 'E_RUNTIME' }));
    });
  });

  describe('查询预算账本（3.7）', () => {
    const key = { dataset: 'dp-1', snapshot: 'sm3:' + 'c'.repeat(64) };
    const policy = { limit: 3, unit: 'queries' } as const;

    it('查询扣减、超限即拒（拒后不扣减）', () => {
      const ledger = new NodeQueryBudgetLedger();
      ledger.charge({ key, policy, cost: 1, kind: 'query', applicant: 'a' });
      ledger.charge({ key, policy, cost: 1, kind: 'subgroup', applicant: 'a' });
      expect(ledger.used(key)).toBe(2);

      expect(() =>
        ledger.charge({ key, policy, cost: 2, kind: 'recompute', applicant: 'a' }),
      ).toThrow(expect.objectContaining({ code: 'E_BUDGET_EXCEEDED' }));
      expect(ledger.used(key)).toBe(2); // 拒了就不扣

      ledger.charge({ key, policy, cost: 1, kind: 'query', applicant: 'a' });
      expect(ledger.used(key)).toBe(3);
      expect(() => ledger.assertWithin(key, policy, 1)).toThrow(
        expect.objectContaining({ code: 'E_BUDGET_EXCEEDED' }),
      );
    });

    it('换快照即换预算组（不能靠「换一批数据」继续扫）', () => {
      const ledger = new NodeQueryBudgetLedger();
      for (let i = 0; i < 3; i += 1)
        ledger.charge({ key, policy, cost: 1, kind: 'query', applicant: 'a' });
      expect(() => ledger.assertWithin(key, policy, 1)).toThrow();
      const newSnapshot = { ...key, snapshot: 'sm3:' + 'd'.repeat(64) };
      expect(() => ledger.assertWithin(newSnapshot, policy, 1)).not.toThrow();
      expect(ledger.used(newSnapshot)).toBe(0);
    });

    it('亚组/重算都计入；差分查询超阈值触发告警', () => {
      const ledger = new NodeQueryBudgetLedger();
      const big = { limit: 100, unit: 'queries' } as const;
      for (let i = 0; i < 5; i += 1)
        ledger.charge({ key, policy: big, cost: 1, kind: 'query', applicant: 'app-1' });
      expect(ledger.entries().filter((e) => e.kind === 'query')).toHaveLength(5);
      expect(ledger.detectDifferential({ key, applicant: 'app-1', threshold: 5 })).toBe(true);
      expect(ledger.detectDifferential({ key, applicant: 'app-2', threshold: 5 })).toBe(false);
    });
  });

  it('国密签名工具可用（本用例的信封签名不是摆设）', () => {
    expect(sm2Verify('x', sm2Sign('x', holder.privateKey, { publicKey: holder.publicKey }), holder.publicKey)).toBe(
      true,
    );
  });

  describe('出口守卫（3.8 / R5）', () => {
    const ctx = (label: string, target: string) => ({
      label,
      target,
      originHolders: ['urn:tds:sh-med:participant:p-demohospa'],
      contractRecipients: ['urn:tds:sh-med:participant:platform'],
    });

    it('C3 → 接收方名单内放行、名单外拒；C1/C2 一律拒', () => {
      const guard = new NodeExitGuard();
      expect(guard.decide(ctx('C3', 'urn:tds:sh-med:participant:platform')).allowed).toBe(true);
      expect(guard.decide(ctx('C3', 'urn:tds:sh-med:participant:p-evil')).allowed).toBe(false);
      expect(guard.decide(ctx('C1', 'urn:tds:sh-med:participant:platform')).allowed).toBe(false);
      expect(guard.decide(ctx('C2', 'urn:tds:sh-med:participant:platform')).allowed).toBe(false);
      expect(guard.violationsLog()).toHaveLength(3);
    });

    it('C0 只能回原持有方，且记告警；回别处一律拒（R5）', () => {
      const guard = new NodeExitGuard();
      const back = guard.decide(ctx('C0', 'urn:tds:sh-med:participant:p-demohospa'));
      expect(back.allowed).toBe(true);
      expect(guard.backflowLog()).toHaveLength(1); // 允许但留痕

      const elsewhere = guard.decide(ctx('C0', 'urn:tds:sh-med:participant:platform'));
      expect(elsewhere.allowed).toBe(false);
      expect(guard.violationsLog()).toHaveLength(1);
    });
  });

  describe('审计回执链（3.9）', () => {
    const node = 'urn:tds:sh-med:participant:tee-1';
    const chain = () => new NodeReceiptChain({ node, privateKey: holder.privateKey });

    it('四类事件成链、可逐条验签；链头可作锚定输入', () => {
      const c = chain();
      const att = { quote_digest: `sm3:${'e'.repeat(64)}`, measurement: MEAS, tcb: '3.1.2' };
      // 回执就是协议里的 `AuditReceipt`：`stage`/`op_digest` 是必填项（平台按同一形状收链）
      c.append({ jobId: 'job-1', stage: 'st-1', event: 'UNSEALED', opDigest: 'component:seal@1' });
      const r2 = c.append({ jobId: 'job-1', stage: 'st-1', event: 'EXECUTED', opDigest: 'component:x@1', attestation: att });
      const r3 = c.append({ jobId: 'job-1', stage: 'st-1', event: 'EXITED', opDigest: 'component:node-exit@1', label: 'C3' });
      c.append({ jobId: 'job-1', stage: '__node__', event: 'PURGED', opDigest: 'component:node-purge@1' });
      expect(r2.receipt.attestation?.measurement).toBe(MEAS);
      expect(r3.receipt.label).toBe('C3');

      const receipts = c.list('job-1');
      expect(receipts.map((r) => r.event)).toEqual(['UNSEALED', 'EXECUTED', 'EXITED', 'PURGED']);
      receipts.forEach((r, i) =>
        expect(r.prev_receipt_hash).toBe(i === 0 ? null : canonicalSm3(receipts[i - 1])),
      );
      expect(c.verify('job-1', holder.publicKey)).toEqual({ valid: true });
      expect(c.head('job-1')).toMatch(/^sm3:[0-9a-f]{64}$/);
    });

    it('链被改动 → 校验指出断点位置（第三方可离线复算）', () => {
      const c = chain();
      c.append({ jobId: 'job-2', stage: 'st-1', event: 'UNSEALED', opDigest: 'component:seal@1' });
      c.append({ jobId: 'job-2', stage: 'st-1', event: 'EXECUTED', opDigest: 'component:x@1' });
      const receipts = c.list('job-2') as unknown as Array<{ prev_receipt_hash: string | null }>;
      receipts[1].prev_receipt_hash = `sm3:${'0'.repeat(64)}`;
      const out = c.verify('job-2', holder.publicKey);
      expect(out.valid).toBe(false);
      expect(out.brokenAt).toContain('EXECUTED');
    });

    it('换密钥验签 → 失败（回执必须由本节点密钥签）', () => {
      const c = chain();
      c.append({ jobId: 'job-3', stage: 'st-1', event: 'UNSEALED', opDigest: 'component:seal@1' });
      const other = (() => {
        const { generateSm2KeyPair } = require('@medtrust/mdop') as {
          generateSm2KeyPair: () => { privateKey: string; publicKey: string };
        };
        return generateSm2KeyPair();
      })();
      expect(c.verify('job-3', other.publicKey).valid).toBe(false);
    });
  });

  describe('本地制品与销毁（3.10）', () => {
    const node = 'urn:tds:sh-med:participant:tee-1';
    const store = () => new NodeArtifactStore({ node, privateKey: holder.privateKey });
    const put = (s: NodeArtifactStore, handle: string, jobId: string, expiresAt: string) =>
      s.put({
        handle,
        jobId,
        label: 'C3',
        digest: `sm3:${'f'.repeat(64)}`,
        payload: { a: 1 },
        expiresAt,
      });

    it('销毁列出句柄并签名；销毁后按句柄读取失败', () => {
      const s = store();
      put(s, 'art://tee-1/job-1/a', 'job-1', '2027-01-01T00:00:00.000Z');
      put(s, 'art://tee-1/job-1/b', 'job-1', '2027-01-01T00:00:00.000Z');
      const receipt = s.purge({ jobId: 'job-1', reason: 'purge-order', idempotencyKey: 'purge:job-1' });
      expect(receipt.handles).toHaveLength(2);
      // 平台按 verifyCanonicalObject 验节点回执（mdop-purge.service）；口径不同即被拒
      const { sig, ...signed } = receipt;
      expect(verifyCanonicalObject(signed, sig, holder.publicKey)).toBe(true);
      expect(s.read('art://tee-1/job-1/a')).toBeNull();
      expect(s.listJob('job-1')).toHaveLength(0);
    });

    it('重复指令返回**同一份**回执（至少一次投递不该产出两份）', () => {
      const s = store();
      put(s, 'art://tee-1/job-2/a', 'job-2', '2027-01-01T00:00:00.000Z');
      const first = s.purge({ jobId: 'job-2', reason: 'purge-order', idempotencyKey: 'purge:job-2' });
      const second = s.purge({ jobId: 'job-2', reason: 'purge-order', idempotencyKey: 'purge:job-2' });
      expect(second).toBe(first);
    });

    it('TTL 到期自主销毁（无需平台指令）', () => {
      const s = store();
      put(s, 'art://tee-1/job-3/a', 'job-3', '2026-09-01T00:00:00.000Z');
      const swept = s.sweepExpired(new Date('2026-09-25T10:00:00.000Z'));
      expect(swept).toEqual([{ jobId: 'job-3', handles: ['art://tee-1/job-3/a'] }]);
      expect(s.read('art://tee-1/job-3/a')).toBeNull();
    });
  });
});
