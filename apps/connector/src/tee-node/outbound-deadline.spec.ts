import { MdopError, generateSm2KeyPair, type KeyReleaseRequest } from '@medtrust/mdop';
import { HttpSealKeyDepositor } from '../wiring/wire-seal';
import { sendNodeHeartbeat } from './registration';
import { HttpKmsClient } from './remote-kms';

/**
 * 节点 / 连接器其余几条**串行循环上的出站调用**也要有总时限（2026-10-07 真机事故回归）。
 *
 * 事故当天坏的是 KMS 隧道：它「拒连」时请求立刻失败、可重试；但它「卡住」时——
 * 托付（持有方封装）、释放（节点解封）、心跳（节点每轮轮询之前）任何一条不返回，
 * 整个进程就静默。三处都要在时限内放行调用方，且超时不得被说成「保管方拒绝」。
 */
const KEYS = generateSm2KeyPair();
const KMS_KEYS = generateSm2KeyPair();
const neverSettles = <T>(): Promise<T> => new Promise<T>(() => undefined);

const hanging = () => {
  const signals: AbortSignal[] = [];
  const impl = ((_url: string | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return neverSettles<Response>();
  }) as unknown as typeof fetch;
  return { impl, signals };
};

describe('串行循环上的出站调用都有总时限', () => {
  it('密钥托付（持有方封装）：保管方卡住 → E_TIMEOUT（可重试），不是 E_ENVELOPE_POLICY', async () => {
    const { impl, signals } = hanging();
    const depositor = new HttpSealKeyDepositor({
      url: 'http://127.0.0.1:1/kms/deposit',
      kmsPublicKey: KMS_KEYS.publicKey,
      holder: 'p-demohospb',
      privateKey: () => KEYS.privateKey,
      fetchImpl: impl,
      timeoutMs: 40,
    });
    const failure = await depositor
      .depositKey({ jobId: 'job-1', keyId: 'k-1', dek: Buffer.alloc(32, 7), contractId: 'ctr-1' })
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(MdopError);
    expect((failure as MdopError).code).toBe('E_TIMEOUT');
    expect((failure as MdopError).retryable).toBe(true);
    expect(signals[0]?.aborted).toBe(true);
  }, 20_000);

  it('密钥释放（节点解封）：保管方卡住 → E_TIMEOUT（可重试），不是 E_KEY_RELEASE_DENIED', async () => {
    const { impl, signals } = hanging();
    const kms = new HttpKmsClient({
      kmsRef: 'kms://pilot',
      url: 'http://127.0.0.1:1/kms/release',
      participantId: 'tee-node-a',
      privateKey: KEYS.privateKey,
      evidence: { evidenceFor: () => 'cXVvdGU=' },
      fetchImpl: impl,
      timeoutMs: 40,
    });
    const failure = await kms
      .requestRelease({
        key_id: 'k-1',
        context: { job_id: 'job-1', credential_id: 'tkt-1', contract_id: 'ctr-1', key_id: 'k-1' },
        report: { quote_digest: `sm3:${'a'.repeat(64)}` },
        policy: { tee: ['tdx'] },
        credential_valid: true,
        contract_active: true,
      } as unknown as KeyReleaseRequest)
      .catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(MdopError);
    expect((failure as MdopError).code).toBe('E_TIMEOUT');
    expect(signals[0]?.aborted).toBe(true);
  }, 20_000);

  it('心跳（每轮轮询之前）：平台卡住 → 这一拍在时限内失败，不拖住后面的长轮询', async () => {
    const { impl, signals } = hanging();
    const started = Date.now();
    await expect(
      sendNodeHeartbeat({
        baseUrl: 'http://127.0.0.1:1/api/v1',
        participantId: 'tee-node-a',
        certFingerprint: 'SM2:NODE',
        privateKey: KEYS.privateKey,
        advertisement: { tee: null },
        fetchImpl: impl,
        timeoutMs: 40,
      }),
    ).rejects.toThrow(/节点心跳超时/);
    // 上界只排除「挂到缺省 60 秒」。全量并跑时签名会把这一拍拖到数秒，2 秒会假红。
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(signals[0]?.aborted).toBe(true);
  }, 20_000);
});
