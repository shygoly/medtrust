import { ContractView } from "../contract-view";
import type { UsageAction, UsagePolicy } from "./engine";

/**
 * 旧合约 → 策略的**默认翻译**。
 *
 * 关键约定（ndi-usage-control-engine）：没有策略的历史合约**不得**被翻译成空策略，
 * 否则 `decide` 会落到 `DEFAULT_DENY`，让所有历史任务一夜被拒。
 * 这里把 legacy PEP 的语义等价地写成一条 allow 授权：
 * 目的限定 + 有效期上限；合约不可用时写一条 deny（明确拒绝，而不是"没规则"）。
 */
export function policyFromContract(
  contract: ContractView | undefined,
  action: UsageAction = "compute",
): UsagePolicy {
  const id = `legacy:${contract?.id ?? "no-contract"}`;
  if (!contract || contract.status !== "active") {
    return {
      version: 1,
      id,
      grants: [
        {
          effect: "deny",
          subject: contract?.providerId ?? "provider",
          object: contract?.dataProductId ?? "unknown",
          action,
        },
      ],
    };
  }
  return {
    version: 1,
    id,
    grants: [
      {
        effect: "allow",
        subject: contract.providerId ?? "provider",
        object: contract.dataProductId ?? "unknown",
        action,
        constraints: {
          purposes: [contract.purpose],
          ...(contract.validUntil ? { notAfter: contract.validUntil } : {}),
        },
      },
    ],
  };
}

/** 由合约构造一次使用请求（与 policyFromContract 同口径）。 */
export function requestFromContract(
  contract: ContractView | undefined,
  input: { purpose: string; now?: number },
): {
  subject: string;
  object: string;
  action: UsageAction;
  purpose: string;
  now: number;
} {
  return {
    subject: contract?.providerId ?? "provider",
    object: contract?.dataProductId ?? "unknown",
    action: "compute",
    purpose: input.purpose,
    now: input.now ?? Date.now(),
  };
}
