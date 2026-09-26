import { canonicalSm3, type Envelope, type SessionWitness } from '@medtrust/mdop';
import type { MdopOutboundClient } from '../mdop/mdop-client';

/**
 * 会话见证的**上报端**（任务 6.7 的发送侧、design D14）。
 *
 * 节点把「本次证明 + KMS 释放凭据」作为 `AttestationReport` 交给平台；平台验签、登记本体并
 * 原样转发给持有方。这里只负责**把本体完整装进消息**——不摘要、不裁剪：
 * 收到摘要的持有方验不了签，「独立校验」就会退化成信平台。
 *
 * 幂等键按 `job_id + key_id + 凭据摘要` 取：至少一次投递下重复上报同一份见证不会产生第二条。
 */

export function witnessIdempotencyKey(witness: SessionWitness): string {
  return `witness:${witness.job_id}:${witness.key_id}:${witness.warrant.warrant_digest}`;
}

export function buildWitnessEnvelope(
  witness: SessionWitness,
  input: { receiver: string; outbound: MdopOutboundClient },
): Envelope {
  if (!witness.node)
    throw new Error('会话见证缺少节点身份（node）——不得上报匿名见证');
  if (!witness.warrant?.warrant_digest)
    throw new Error('会话见证缺少释放凭据摘要——不得上报半份见证');
  return input.outbound.buildEnvelope({
    msgType: 'AttestationReport',
    jobId: witness.job_id,
    receiver: input.receiver,
    idempotencyKey: witnessIdempotencyKey(witness),
    body: { witness: witness as unknown as Record<string, unknown> },
  });
}

export async function reportWitness(
  witness: SessionWitness,
  input: { receiver: string; outbound: MdopOutboundClient },
): Promise<{ envelope: Envelope; digest: string }> {
  const envelope = buildWitnessEnvelope(witness, input);
  await input.outbound.sendMessage(envelope);
  return { envelope, digest: canonicalSm3(witness) };
}

/** 批量上报一次会话的全部见证（每个 `key_id` 一条）。 */
export async function reportSessionWitnesses(
  witnesses: readonly SessionWitness[],
  input: { receiver: string; outbound: MdopOutboundClient },
): Promise<number> {
  let sent = 0;
  for (const witness of witnesses) {
    await reportWitness(witness, input);
    sent += 1;
  }
  return sent;
}
