import { sm2 } from 'sm-crypto';
import { signSm2 } from './sm2-sign';
import {
  CONNECTOR_TASK_SIGNATURE_PREFIX,
  SignedConnectorTask,
  connectorTaskCanonical,
  connectorTaskSignaturePayload,
  connectorTaskSm3,
  verifySignedConnectorTask,
} from './connector-task-signature';

const PARTICIPANT = 'p-huashan';
const ISSUED_AT = '2026-09-18T00:00:00.000Z';
const PAYLOAD = { assignmentId: 'a-1', taskId: 't-1' };

/**
 * 跨平面契约夹具:规范化内容与 SM3 是**写死的字面量**。
 * 平台侧 connector-task-signer.spec.ts 断言同一对值 —— 任一侧改了字段名/排序即红。
 */
const CANONICAL =
  '{"issuedAt":"2026-09-18T00:00:00.000Z","participantId":"p-huashan","payload":{"assignmentId":"a-1","taskId":"t-1"},"taskId":"a-1","taskKind":"rws"}';
const CANONICAL_SM3 =
  '94d53f61711e459c1b2e2302339909930caa464e97a5426cc2ca57cc15df7842';

const keypair = sm2.generateKeyPairHex();

function signedTask(
  over: Partial<SignedConnectorTask<typeof PAYLOAD>> = {},
): SignedConnectorTask<typeof PAYLOAD> {
  const base = {
    kind: 'rws' as const,
    participantId: PARTICIPANT,
    taskId: 'a-1',
    issuedAt: ISSUED_AT,
    payload: PAYLOAD,
  };
  const sm3 = connectorTaskSm3({ taskKind: base.kind, ...base });
  return {
    ...base,
    sm3,
    // 与线上同口径：国标 SM2（Z_A + DER），D-MDOP-3。
    signature: signSm2(
      connectorTaskSignaturePayload(sm3),
      keypair.privateKey,
      keypair.publicKey,
    ),
    algorithm: 'SM2-SM3',
    ...over,
  };
}

const verify = (task: unknown, now = Date.parse(ISSUED_AT) + 1_000) =>
  verifySignedConnectorTask(task, {
    participantId: PARTICIPANT,
    platformNodePublicKey: keypair.publicKey,
    now,
  });

describe('下发任务签名 (outbound-longpoll-agent-auth D4)', () => {
  it('规范化口径与平台侧一致(字面量对拍)', () => {
    expect(
      connectorTaskCanonical({
        participantId: PARTICIPANT,
        taskKind: 'rws',
        taskId: 'a-1',
        issuedAt: ISSUED_AT,
        payload: PAYLOAD,
      }),
    ).toBe(CANONICAL);
    expect(connectorTaskSm3({
      participantId: PARTICIPANT,
      taskKind: 'rws',
      taskId: 'a-1',
      issuedAt: ISSUED_AT,
      payload: PAYLOAD,
    })).toBe(CANONICAL_SM3);
    expect(connectorTaskSignaturePayload(CANONICAL_SM3)).toBe(
      `${CONNECTOR_TASK_SIGNATURE_PREFIX}${CANONICAL_SM3}`,
    );
  });

  it('签名有效且目标参与方是自己 → 通过', () => {
    const result = verify(signedTask());
    expect(result.ok).toBe(true);
  });

  it('不带签名 → 拒绝', () => {
    const result = verify(signedTask({ signature: '' }));
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('任务发给别的参与方 → 拒绝', () => {
    const result = verify(signedTask({ participantId: 'p-ruijin' }));
    expect(result).toMatchObject({ ok: false, reason: 'wrong-participant' });
  });

  it('载荷被改一个字段 → 摘要不符', () => {
    const result = verify(signedTask({ payload: { assignmentId: 'a-1', taskId: 't-2' } }));
    expect(result).toMatchObject({ ok: false, reason: 'sm3-mismatch' });
  });

  it('伪造签名(另一把密钥) → 验签失败', () => {
    const other = sm2.generateKeyPairHex();
    const attacker = signedTask();
    const forged = {
      ...attacker,
      // 另一把密钥签出来的国标签名（用途/身份不符 → 必须验不过）
      signature: signSm2(
        connectorTaskSignaturePayload(attacker.sm3),
        other.privateKey,
        other.publicKey,
      ),
    };
    expect(verify(forged)).toMatchObject({ ok: false, reason: 'signature-invalid' });
  });

  it('签发时间过旧(>10min) → 拒绝', () => {
    const result = verify(signedTask(), Date.parse(ISSUED_AT) + 11 * 60_000);
    expect(result).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('签发时间在未来太远 → 拒绝', () => {
    const result = verify(signedTask(), Date.parse(ISSUED_AT) - 10 * 60_000);
    expect(result).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('未配置平台公钥 → fail-closed', () => {
    const result = verifySignedConnectorTask(signedTask(), {
      participantId: PARTICIPANT,
      platformNodePublicKey: '',
      now: Date.parse(ISSUED_AT) + 1_000,
    });
    expect(result).toMatchObject({ ok: false, reason: 'no-platform-node-pubkey' });
  });

  it('旧格式签名在线上链路被拒（防降级，D-MDOP-3）', () => {
    // 切换前的口径：不做 Z_A、原始 r‖s。同一把密钥、同一段载荷 —— 仍必须被拒。
    const legacy = signedTask();
    legacy.signature = sm2.doSignature(
      connectorTaskSignaturePayload(legacy.sm3),
      keypair.privateKey,
    );
    expect(verify(legacy)).toMatchObject({ ok: false, reason: 'signature-invalid' });
  });

  it('三种任务类型都可验签', () => {
    for (const kind of ['rws', 'fl-prediction', 'fl-round'] as const) {
      const task = signedTask({
        kind,
        sm3: connectorTaskSm3({
          participantId: PARTICIPANT,
          taskKind: kind,
          taskId: 'a-1',
          issuedAt: ISSUED_AT,
          payload: PAYLOAD,
        }),
      });
      task.signature = signSm2(
        connectorTaskSignaturePayload(task.sm3),
        keypair.privateKey,
        keypair.publicKey,
      );
      expect(verify(task).ok).toBe(true);
    }
  });
});
