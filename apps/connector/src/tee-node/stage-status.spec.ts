import { MdopOutboundClient } from '../mdop/mdop-client';
import { generateSm2KeyPair } from '@medtrust/mdop';
import { reportNodeStageStatus } from './stage-status';

/**
 * 节点侧阶段状态上报（任务 3.12e）：形状必须与数据持有方**完全同口径**，
 * 否则平台侧就要为节点开特例——那正是「同一件事两处实现」的开端。
 */

const PLATFORM = 'urn:tds:sh-med:participant:platform';

function outboundRecorder() {
  const outbound = new MdopOutboundClient({
    baseUrl: 'http://127.0.0.1:1/api/v1',
    participantId: 'tee-1',
    privateKey: generateSm2KeyPair().privateKey,
  });
  const sent: Array<{ msg_type: string; job_id: string; receiver: string; idempotency_key: string; body: Record<string, unknown> }> = [];
  (outbound as unknown as { sendMessage: unknown }).sendMessage = async (envelope: {
    msg_type: string;
    job_id: string;
    receiver: string;
    idempotency_key: string;
    body: Record<string, unknown>;
  }) => {
    sent.push(envelope);
    return { ok: true };
  };
  return { outbound, sent };
}

describe('节点阶段状态上报（任务 3.12e）', () => {
  it('成功：形状与幂等键与数据持有方一致，只带摘要与等级（无载荷）', async () => {
    const { outbound, sent } = outboundRecorder();
    await reportNodeStageStatus(
      { outbound, platform: PLATFORM },
      {
        jobId: 'job-1',
        stageId: 'dec',
        credentialId: 'tkt-1',
        attempt: 2,
        status: 'SUCCEEDED',
        digest: `sm3:${'a'.repeat(64)}`,
        label: 'C3',
      },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      msg_type: 'StageStatus',
      job_id: 'job-1',
      receiver: PLATFORM,
      idempotency_key: 'status:job-1:dec:2',
    });
    expect(sent[0].body).toEqual({
      job_id: 'job-1',
      stage_id: 'dec',
      ticket_id: 'tkt-1',
      attempt: 2,
      status: 'SUCCEEDED',
      digest: `sm3:${'a'.repeat(64)}`,
      label: 'C3',
    });
    // 控制面不得夹带制品内容：这里连 payload 字段都不该出现
    expect(JSON.stringify(sent[0].body)).not.toContain('payload');
  });

  it('失败：带错误码（平台据此决定重试还是判失败）', async () => {
    const { outbound, sent } = outboundRecorder();
    await reportNodeStageStatus(
      { outbound, platform: PLATFORM },
      {
        jobId: 'job-2',
        stageId: 'pair',
        credentialId: 'tkt-2',
        attempt: 1,
        status: 'FAILED',
        code: 'E_RUNTIME',
        message: '上游制品不在本节点',
      },
    );
    expect(sent[0].body).toMatchObject({
      status: 'FAILED',
      code: 'E_RUNTIME',
      message: '上游制品不在本节点',
    });
  });
});
