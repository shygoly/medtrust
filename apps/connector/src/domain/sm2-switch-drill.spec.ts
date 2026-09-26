// 切换演练（任务 4.7 的**本机可跑**部分）：平台侧三钥 × 连接器侧按用途验签的跨端对拍。
//
// 这里不启 Nest 进程，而是用与平台**完全相同**的构件复刻平台侧的签发路径：
//   - 载荷口径：`medtrust.connector-task.v1:<sm3>`（与
//     apps/api/src/runtime/participant-identity/ca.service.ts 的 taskSignaturePayload 同串）
//   - 签名口径：国标 SM2（Z_A + DER，@medtrust/mdop，`SM2-SM3`）
//   - 密钥用途：任务签名用平台节点密钥、模块签名用注册中心密钥、证书记录用 CA 根钥
// 然后走连接器真实的验签入口 `verifyByPurpose` / `verifySignedConnectorTask`。
//
// 断言三件事：① 对应用途的密钥验得过；② 用错密钥一律拒绝；③ 旧格式（切换前口径）
// 在线上链路被拒，仅在显式开启历史核验时接受。
import { generateSm2KeyPair, sm2Sign } from '@medtrust/mdop';
import { sm2 } from 'sm-crypto';
import {
  CONNECTOR_TASK_SIGNATURE_PREFIX,
  connectorTaskSignaturePayload,
  connectorTaskSm3,
  verifySignedConnectorTask,
} from './connector-task-signature';
import { verifyByPurpose } from './platform-keys';

const TASK_SIGNATURE_PAYLOAD_PREFIX = 'medtrust.connector-task.v1:';
const MODULE_SIGNATURE_PAYLOAD_PREFIX = 'medtrust.algorithm-module.v1:';

const SM3 = 'a'.repeat(64);
const PARTICIPANT = 'p-huashan';
const ISSUED_AT = '2026-09-18T00:00:00.000Z';
const PAYLOAD = { assignmentId: 'a-1', taskId: 't-1' };

/** 复刻平台侧签发：同一载荷口径 + 国标 SM2 + 指定用途的密钥。 */
function platformSignedTask(keys: { publicKey: string; privateKey: string }) {
  const sm3 = connectorTaskSm3({
    participantId: PARTICIPANT,
    taskKind: 'rws',
    taskId: 'a-1',
    issuedAt: ISSUED_AT,
    payload: PAYLOAD,
  });
  return {
    kind: 'rws' as const,
    participantId: PARTICIPANT,
    taskId: 'a-1',
    issuedAt: ISSUED_AT,
    payload: PAYLOAD,
    sm3,
    signature: sm2Sign(connectorTaskSignaturePayload(sm3), keys.privateKey, {
      publicKey: keys.publicKey,
    }),
    algorithm: 'SM2-SM3',
  };
}

describe('SM2 国标化 + 三钥分离的跨端切换演练（任务 4.7）', () => {
  const caRoot = generateSm2KeyPair();
  const platformNode = generateSm2KeyPair();
  const registry = generateSm2KeyPair();

  beforeEach(() => {
    process.env.CONNECTOR_PLATFORM_CA_PUBKEY = caRoot.publicKey;
    process.env.CONNECTOR_PLATFORM_NODE_PUBKEY = platformNode.publicKey;
    process.env.CONNECTOR_REGISTRY_PUBKEY = registry.publicKey;
  });

  afterEach(() => {
    for (const key of [
      'CONNECTOR_PLATFORM_CA_PUBKEY',
      'CONNECTOR_PLATFORM_NODE_PUBKEY',
      'CONNECTOR_REGISTRY_PUBKEY',
    ])
      delete process.env[key];
  });

  it('载荷口径两端一致（跨平面契约字面量）', () => {
    expect(CONNECTOR_TASK_SIGNATURE_PREFIX).toBe(TASK_SIGNATURE_PAYLOAD_PREFIX);
    expect(connectorTaskSignaturePayload(SM3)).toBe(
      `${TASK_SIGNATURE_PAYLOAD_PREFIX}${SM3}`,
    );
  });

  it('① 平台节点密钥签的任务：连接器验得过，作业可下发', () => {
    const task = platformSignedTask(platformNode);
    const result = verifySignedConnectorTask(task, {
      participantId: PARTICIPANT,
      platformNodePublicKey: platformNode.publicKey,
      now: Date.parse(ISSUED_AT) + 1_000,
    });
    expect(result).toMatchObject({ ok: true });
  });

  it('② 用 CA 根钥签同一份任务 → 连接器拒收（用错密钥的对象一律拒绝）', () => {
    const task = platformSignedTask(caRoot);
    expect(
      verifySignedConnectorTask(task, {
        participantId: PARTICIPANT,
        platformNodePublicKey: platformNode.publicKey,
        now: Date.parse(ISSUED_AT) + 1_000,
      }),
    ).toMatchObject({ ok: false, reason: 'signature-invalid' });
  });

  it('模块签名只认注册中心密钥（CA 根钥签的模块被拒）', () => {
    const message = `${MODULE_SIGNATURE_PAYLOAD_PREFIX}${SM3}`;
    const byRegistry = sm2Sign(message, registry.privateKey, {
      publicKey: registry.publicKey,
    });
    const byCaRoot = sm2Sign(message, caRoot.privateKey, { publicKey: caRoot.publicKey });
    expect(verifyByPurpose('registry', message, byRegistry)).toMatchObject({ ok: true });
    expect(verifyByPurpose('registry', message, byCaRoot)).toMatchObject({
      ok: false,
      reason: 'signature-invalid',
    });
  });

  it('③ 旧格式（切换前口径）任务签名在线上链路被拒', () => {
    const task = platformSignedTask(platformNode);
    // 覆盖成旧格式：不做 Z_A、原始 r‖s
    task.signature = sm2.doSignature(
      connectorTaskSignaturePayload(task.sm3),
      platformNode.privateKey,
    );
    expect(
      verifySignedConnectorTask(task, {
        participantId: PARTICIPANT,
        platformNodePublicKey: platformNode.publicKey,
        now: Date.parse(ISSUED_AT) + 1_000,
      }),
    ).toMatchObject({ ok: false, reason: 'signature-invalid' });
  });
});
