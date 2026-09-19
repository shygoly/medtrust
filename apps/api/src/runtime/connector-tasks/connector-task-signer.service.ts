import { Injectable } from "@nestjs/common";
import { stableStringify } from "../../common/canonical-json";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import {
  ConnectorTaskKind,
  ConnectorTaskSignatureInput,
  SignedConnectorTask,
} from "./types";

/**
 * 下发任务签名的载荷口径：对任务摘要加域分隔前缀后再做 SM2。
 * 连接器侧同串（apps/connector/src/domain/connector-task-signature.ts）——
 * 两处改动必须同步。
 */
export const CONNECTOR_TASK_SIGNATURE_PREFIX = "medtrust.connector-task.v1:";

export function connectorTaskSignaturePayload(sm3: string): string {
  return `${CONNECTOR_TASK_SIGNATURE_PREFIX}${sm3.toLowerCase()}`;
}

/** 规范化任务内容（签名与摘要的共同输入）。 */
export function connectorTaskCanonical(
  input: ConnectorTaskSignatureInput,
): string {
  return stableStringify({
    participantId: input.participantId,
    taskKind: input.taskKind,
    taskId: input.taskId,
    issuedAt: input.issuedAt,
    payload: input.payload,
  });
}

export function connectorTaskSm3(
  input: ConnectorTaskSignatureInput,
  gm: GMCryptoService,
): string {
  return gm.sm3Hash(connectorTaskCanonical(input));
}

/**
 * 平台对下发任务的 SM2 签名（design D4）。连接器只认部署配置里固定的平台 CA 公钥，
 * 因此代理或中间人无法伪造任务。
 */
@Injectable()
export class ConnectorTaskSigner {
  constructor(
    private readonly ca: CaService,
    private readonly gm: GMCryptoService,
  ) {}

  sign<T>(
    participantId: string,
    kind: ConnectorTaskKind,
    taskId: string,
    payload: T,
    issuedAt = new Date().toISOString(),
  ): SignedConnectorTask<T> {
    const sm3 = connectorTaskSm3(
      { participantId, taskKind: kind, taskId, issuedAt, payload },
      this.gm,
    );
    return {
      kind,
      participantId,
      taskId,
      issuedAt,
      payload,
      sm3,
      signature: this.ca.signTaskDigest(sm3),
      algorithm: "SM2-SM3",
    };
  }
}
