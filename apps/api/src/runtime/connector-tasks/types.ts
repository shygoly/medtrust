/** 连接器长轮询下发的任务种类（outbound-longpoll-agent-auth）。 */
export type ConnectorTaskKind = "rws" | "fl-prediction" | "fl-round";

/**
 * 平台签名的下发任务信封（design D4）。
 *
 * 签名内容 = stableStringify({ participantId, taskKind, taskId, issuedAt, payload })
 * → SM3 → 平台 CA 的 SM2 签名（载荷 `medtrust.connector-task.v1:<sm3>`）。
 * 连接器用部署配置里固定的平台 CA 公钥验签，并检查目标参与方、时效、taskId 去重。
 */
export interface SignedConnectorTask<T = unknown> {
  kind: ConnectorTaskKind;
  /** 目标任务参与方（连接器必须检查它等于自己，design D4）。 */
  participantId: string;
  /** 去重与回执标识：RWS/FL 预测 = assignmentId；训练轮次 = roundTaskId。 */
  taskId: string;
  issuedAt: string;
  payload: T;
  sm3: string;
  signature: string;
  algorithm: "SM2-SM3";
}

export interface ConnectorTaskBatch {
  participantId: string;
  serverTime: string;
  /** 服务端实际采用的等待上限（毫秒）。 */
  waitMs: number;
  rws: SignedConnectorTask[];
  flPrediction: SignedConnectorTask[];
  flRounds: SignedConnectorTask[];
}

export interface ConnectorTaskSignatureInput {
  participantId: string;
  taskKind: ConnectorTaskKind;
  taskId: string;
  issuedAt: string;
  payload: unknown;
}
