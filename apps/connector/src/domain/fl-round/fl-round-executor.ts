// outbound-longpoll-agent-auth D3 —— 连接器中转一院一轮的联邦训练。
//
// 领到轮次任务后依次：验签（在 worker 里统一做）→ PEP 校验 → 带共享凭证在院内调用
// 本院 agent 的 RunLocalRound → 回传结果（附结果 SM3 与连接器 SM2 签名）。
import { Injectable, Optional } from '@nestjs/common';
import { sm2 } from 'sm-crypto';
import { AuditService } from '../audit';
import { ContractView } from '../contract-view';
import { PolicyEnforcementPoint } from '../policy-enforcement';
import { sm3Hex } from '../sm3';
import { stableStringify } from '../canonical-json';
import { RwsArtifactKind } from '../types';
import { ConnectorFlRoundTask } from '../control-plane-client';
import {
  FlRoundAgentClient,
  RunLocalRoundResult,
  agentSharedToken,
} from './fl-round-agent-client';

export type { ConnectorFlRoundTask };

export interface FlRoundCompletionPayload {
  adapterDeltaJson: string;
  sampleCount: number;
  localLoss: number;
  message: string;
  resultSm3: string;
  signature: string;
}

/** 结果摘要口径：连接器算 SM3 → 用连接器 SM2 私钥签名（平台用证书公钥验）。 */
export function flRoundResultSm3(result: {
  adapterDeltaJson: string;
  sampleCount: number;
  localLoss: number;
  message?: string;
}): string {
  return sm3Hex(
    stableStringify({
      adapterDeltaJson: result.adapterDeltaJson,
      sampleCount: result.sampleCount,
      localLoss: result.localLoss,
      message: result.message ?? '',
    }),
  );
}

export function signRoundResult(
  sm3: string,
  privateKey: string,
): string {
  return sm2.doSignature(sm3, privateKey);
}

@Injectable()
export class FlRoundExecutor {
  private readonly participantId: string;

  constructor(
    private readonly pep: PolicyEnforcementPoint,
    @Optional() private readonly agentClient?: FlRoundAgentClient,
    @Optional() private readonly audit?: AuditService,
    @Optional() participantId?: string,
  ) {
    this.participantId =
      participantId ?? process.env.CONNECTOR_PARTICIPANT_ID ?? '';
  }

  /**
   * 执行一院一轮：PEP → 院内 agent 调用 → 结果载荷（含 SM3 与签名）。
   * 任一失败抛出，由任务层记审计并上报失败（避免编排器空等）。
   */
  async runRound(task: ConnectorFlRoundTask): Promise<FlRoundCompletionPayload> {
    if (!task.contract) {
      throw new Error('训练轮次缺少合约快照，无法做 PEP 校验');
    }
    if (!task.purpose) {
      throw new Error('训练轮次缺少用途声明，无法做 PEP 校验（fail-closed）');
    }
    // PEP:合约须生效、目的相符、允许 L4,且允许模型类产物。
    // 一轮训练回传的是"模型增量",在 RWS 产物词汇表里对应 model_hash
    // (合约 preset=仅模型增量 → model_params/model_update 均包含它)。
    const artifacts: RwsArtifactKind[] = ['model_hash'];
    this.pep.check(
      {
        taskId: task.taskId,
        // 用任务声明的用途比对合约目的：不拿合约自己的目的自证。
        purpose: task.purpose,
        level: 'L4',
        artifacts,
      },
      task.contract,
    );

    const token = agentSharedToken();
    if (!token) {
      throw new Error(
        '未配置 AGENT_SHARED_TOKEN：院内计算后端要求共享凭证，拒绝调用（fail-closed）',
      );
    }

    const client = this.agentClient ?? new FlRoundAgentClient();
    const nodePlan = task.nodePlan.length
      ? task.nodePlan
      : [
          {
            participantId: task.participantId,
            tier: 'pyu_only',
            device: 'cpu',
            offloadAggregation: false,
            localEpochs: 1,
          },
        ];
    const started = Date.now();
    const result: RunLocalRoundResult = await client.runLocalRound(
      {
        taskId: `${task.taskId}::${task.participantId}`,
        specYaml: task.specYaml,
        roundIndex: task.round,
        globalAdapterJson: task.globalAdapterJson,
        nodePlan,
      },
      token,
    );
    if (!result.adapterDeltaJson) {
      throw new Error(
        `agent 未返回本地增量(round=${task.round + 1}):${result.message || '无说明'}`,
      );
    }

    const payload = {
      adapterDeltaJson: result.adapterDeltaJson,
      sampleCount: Number(result.sampleCount ?? 0),
      localLoss: Number(result.localLoss ?? 0),
      message: result.message ?? 'OK',
    };
    const resultSm3 = flRoundResultSm3(payload);
    const privateKey = process.env.CONNECTOR_SM2_PRIVATE_KEY ?? '';
    if (!privateKey) {
      throw new Error(
        '未配置 CONNECTOR_SM2_PRIVATE_KEY：无法对训练结果签名，拒绝回传（fail-closed）',
      );
    }
    this.audit?.record({
      action: 'fl-round-run',
      actor: task.taskId,
      allowed: true,
      detail:
        `round=${task.round + 1} provider=${task.participantId} samples=${payload.sampleCount}` +
        ` loss=${payload.localLoss} durationMs=${Date.now() - started} sm3=${resultSm3.slice(0, 16)}…`,
    });
    return {
      ...payload,
      resultSm3,
      signature: signRoundResult(resultSm3, privateKey),
    };
  }
}
