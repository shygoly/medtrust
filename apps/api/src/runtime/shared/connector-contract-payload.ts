import {
  DigitalContract,
  ContractStatus,
  resolveOutputPolicy,
  outputLabelFromPreset,
  expandToPepArtifacts,
  levelsForPreset,
} from "@medtrust/database";
import { ConnectorContractPayload } from "../rws-orchestrator/types";

/**
 * 合约 → 连接器侧合约视图（下发给连接器的快照，连接器据此做 PEP 校验）。
 *
 * RWS 派发、FL 预测派发、联邦训练轮次三处共用同一份映射，避免各写一份导致
 * 「同一个合约在三条路径上 PEP 判定不同」。
 */
export function toConnectorContractPayload(
  contract: DigitalContract,
  effectiveStatus?: ContractStatus,
): ConnectorContractPayload {
  const outputPolicy = resolveOutputPolicy(contract);
  const status = effectiveStatus ?? contract.status;
  return {
    id: contract.id,
    dataProductId: contract.dataProductId,
    providerId: contract.providerId,
    consumerId: contract.consumerId,
    purpose: contract.purpose,
    retention: contract.retention,
    output: outputLabelFromPreset(outputPolicy.preset),
    outputPolicy,
    allowedArtifacts: expandToPepArtifacts(outputPolicy),
    allowedLevels: levelsForPreset(outputPolicy.preset),
    minCell: outputPolicy.minCell,
    validUntil: contract.validUntil,
    status: status === "active" ? "active" : status,
    ...(contract.pinnedModules
      ? { pinnedModules: contract.pinnedModules }
      : {}),
  };
}
