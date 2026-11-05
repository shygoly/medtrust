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
  /**
   * mdop-kernel（D-MDOP-5）：算子清单（注册中心密钥签名）。
   * 连接器用**部署固定的注册中心公钥**验签后才使用；清单本身不等于授权 ——
   * 还要摘要在本地白名单里才能复核/执行。
   */
  mdopOperators?: Array<{
    ref: string;
    digest: string;
    manifest: Record<string, unknown>;
    signature: { alg: string; kid: string; value: string };
  }>;
  /**
   * mdop-kernel（任务 6.4）：MDOP 算子吊销名单，由**平台节点密钥**签名。
   * 连接器验签、落盘、只接受版本更高的名单；启动后收到有效名单之前拒绝执行 wasm 算子。
   */
  mdopRevocations?: {
    version: number;
    issued_at: string;
    revoked_digests: string[];
    sig: { alg: string; kid: string; value: string };
  };
  /**
   * mdop-kernel（任务 7.2）：平台 → 连接器的 MDOP 消息（合约要约、片段要约、凭证、调度、
   * 销毁指令），取自发件箱随长轮询下发。**至少一次**：未按幂等键回报的会原样重发，
   * 连接器按 `msg_id` / `idempotency_key` 去重。
   */
  mdop?: Array<Record<string, unknown>>;
  /**
   * third-party-module-admission 闸 5：算法模块吊销名单。
   * 随每个批次下发（含空批次）——连接器不必额外轮询就能及时拿到吊销；
   * 版本单调递增，连接器只接受更高版本（防回放旧名单把吊销「撤销」掉）。
   * 与「撤合约固定」叠加生效，两条路互不依赖。
   */
  revocations?: ModuleRevocationList;
  /**
   * connector-agent-deidentification：脱敏规格包（每 specId 的当前有效版本）+
   * 吊销名单。规格由**注册中心用途密钥**签名（`medtrust.deid-spec.v1:<sm3>`），
   * 连接器用部署固定的注册中心公钥验签，并把版本单调落本地。
   * 取不到就不带字段 —— 连接器按 fail-closed 处置（没有可用规格即拒跑 agent 模式）。
   */
  deidSpecs?: Array<{
    specId: string;
    version: number;
    specJson: string;
    specSm3: string;
    signature: string;
    keyId: string;
    issuedAt: string;
    notAfter: string;
    signaturePayload: string;
  }>;
  /**
   * connector-agent-deidentification Phase 2：脱敏词表**清单**（只含摘要与版本）。
   * 词表内容留在医院；平台签的是摘要背书。连接器验签后把 ref/摘要传给 agent，
   * agent 核对本院文件的 SM3。**取不到就不带字段**（引用词表的规格随之 fail-closed）。
   */
  deidDictionaries?: Array<{
    dictionaryId: string;
    version: number;
    sm3: string;
    byteSize: number;
    keyId: string;
    issuedAt: string;
    notAfter: string;
    signature: string;
    signaturePayload: string;
  }>;
  /** 词表吊销名单（版本 = 已吊销条数，只增不减）。 */
  deidDictionaryRevocations?: {
    version: number;
    issuedAt: string;
    revoked: Array<{
      dictionaryId: string;
      version: number;
      sm3: string;
      reason: string;
      revokedAt: string;
      revokedBy: string;
    }>;
  };
  /** 脱敏规格吊销名单（版本 = 已吊销条数，只增不减；回放旧名单无效）。 */
  deidRevocations?: {
    version: number;
    issuedAt: string;
    revoked: Array<{
      specSm3: string;
      specId: string;
      version: number;
      reason: string;
      revokedAt: string;
      revokedBy: string;
    }>;
  };
}

/** 与 @medtrust/wasm-algorithms 的 RevocationList 同形（下发线格式）。 */
export interface ModuleRevocationList {
  version: number;
  issuedAt: string;
  revoked: Array<{
    sm3: string;
    reason: string;
    revokedAt: string;
    revokedBy: string;
    detail?: string;
  }>;
}

export interface ConnectorTaskSignatureInput {
  participantId: string;
  taskKind: ConnectorTaskKind;
  taskId: string;
  issuedAt: string;
  payload: unknown;
}
