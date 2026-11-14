/** 入网挑战串。连接器与平台必须使用同一口径。 */
export const CONNECTOR_ENROLL_PREFIX = "connector-enroll.v1";

export function connectorEnrollPayload(input: {
  timestamp: string;
  connectorId: string;
  participantId: string;
  subjectPublicKey: string;
}): string {
  return [
    CONNECTOR_ENROLL_PREFIX,
    input.timestamp,
    input.connectorId,
    input.participantId,
    input.subjectPublicKey,
  ].join(":");
}
