import type { CardMessage } from '@medtrust/chat-cards';
import type { ContractGate } from '../compliance/compliance';
import { defaultContractRequest } from '../compliance/compliance';
import type { SpaceDirectory } from '../agent/directory';
import { buildContractApprovalCard, buildContractRequestCard } from './card-builder';
import type {
  ContractBundleCardMessage,
  ContractBundleRequirement,
} from '@medtrust/chat-cards';

export interface ContractGateCardInput {
  purpose: string;
  participants: string[];
  directory: SpaceDirectory;
  scenarioId?: string;
  dataProductId?: string;
  validDays?: number;
  requestDefaults?: {
    retention: string;
    output: string;
    minCell: number;
    validDays: number;
  };
}

/**
 * 把合规闸的判定翻译成**现成的卡**（内容确定性，模型只负责原样输出）。
 *
 * 卡片里的取值全部来自工具已经知道的事实（判定、目录、入参），模型没有机会编造合约 id、
 * 参与方或条款——这是 plan「透明可审计」要求的最小实现，也让无 key 的确定性回退
 * （RuleBasedLlmClient）能原样把卡吐出来，不必自己会写合规文案。
 *
 * 三种落点：
 * - 有合约但没生效（未签发 / 未 active）→ `contract_request` 卡，步骤是"等谁做什么"；
 * - 缺合约且已知数据产品 → `contract_approval` 卡（用户点一下就能发起申请）；
 * - 缺合约但不知数据产品 → `contract_request` 卡，引导用户补一个数据产品。
 * - 可用 / 未知（查询故障）→ 不出卡（未知不该升级成"用户不能用"）。
 */
export function buildContractGateCard(
  gate: ContractGate,
  input: ContractGateCardInput,
): CardMessage | undefined {
  const matrix = gate.requirementGates ?? [];
  if (matrix.length > 1) {
    const requirements: ContractBundleRequirement[] = matrix.map((item) => {
      const request =
        item.state === 'missing' || item.state === 'not-usable'
          ? {
              action: 'request_contract',
              ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
              role: item.role,
              participantId: item.participantId,
              dataProductId: item.dataProductId,
              purpose: input.purpose,
              purposeCode: input.purpose,
              retention: input.requestDefaults?.retention ?? '作业完成后 30 天',
              output: input.requestDefaults?.output ?? '仅聚合统计',
              minCell: input.requestDefaults?.minCell ?? 5,
              validDays: input.requestDefaults?.validDays ?? input.validDays ?? 30,
            }
          : undefined;
      return {
        role: item.role ?? 'source',
        participantId: item.participantId,
        dataProductId: item.dataProductId,
        state: item.state,
        ...(item.contractId ? { contractId: item.contractId } : {}),
        ...(item.reason ? { reason: item.reason } : {}),
        ...(request ? { request } : {}),
      };
    });
    const bundleCard: ContractBundleCardMessage = {
      type: 'contract_bundle',
      title: '数据合约包需要补齐',
      description:
        '每个数据源分别核对合约。已就绪的成员不会重复申请；下方只列出需要处理的成员。',
      requirements,
      ...(gate.contractBundle?.bundleId ? { bundleId: gate.contractBundle.bundleId } : {}),
      ...(gate.contractBundle?.version ? { bundleVersion: gate.contractBundle.version } : {}),
      metadata: {
        tool: 'check_contract_status',
        status: gate.status,
        purpose: input.purpose,
      },
    };
    return bundleCard;
  }

  const effectiveDataProductId =
    input.dataProductId ?? (matrix.length === 1 ? matrix[0]?.dataProductId : undefined);
  const provider = effectiveDataProductId
    ? input.directory.dataProducts.find((product) => product.id === effectiveDataProductId)
    : undefined;
  const dataProducts = effectiveDataProductId
    ? [
        {
          participantId: provider?.ownerId ?? input.participants[0] ?? '',
          dataProductId: effectiveDataProductId,
          ...(provider?.name ? { name: provider.name } : {}),
        },
      ]
    : input.participants.map((participantId) => ({ participantId, dataProductId: '' }));

  if (gate.status === 'not-usable' && gate.fix !== 'request_contract') {
    // 已经有合约、只是还没生效（未签发/未 active）：给"等谁做什么"，不要让用户再申请一份。
    return buildContractRequestCard({
      title: '合约还没生效',
      reason: gate.reason ?? '合约尚不可用',
      steps: [
        '等数据提供方签发（申请已提交的话无需重复申请）',
        '签发后回来说一声，我重新检查合约并继续配置',
      ],
      contract: {
        purpose: input.purpose,
        dataProducts,
        autoApprove: false,
        ...(gate.contractId ? { contractId: gate.contractId } : {}),
      },
    });
  }

  if (gate.status === 'missing' || gate.fix === 'request_contract') {
    if (!effectiveDataProductId) {
      return buildContractRequestCard({
        title: '还没有可用的数据合约',
        reason: gate.reason ?? '没有覆盖这些参与方的生效合约',
        steps: [
          '告诉我这次要用哪个数据产品，我可以直接替你发起合约申请',
          '或先在「合规预审」页准备预审，再由我发起申请',
        ],
        contract: { purpose: input.purpose, dataProducts, autoApprove: false },
      });
    }
    return buildContractApprovalCard({
      purpose: input.purpose,
      dataProducts,
      ...(provider?.ownerId ? { providerId: provider.ownerId } : {}),
      ...(input.validDays ? { validDays: input.validDays } : {}),
      request: defaultContractRequest({
        dataProductId: effectiveDataProductId,
        purpose: input.purpose,
        retention: input.requestDefaults?.retention,
        output: input.requestDefaults?.output,
        minCell: input.requestDefaults?.minCell,
        ...(input.validDays ? { validDays: input.validDays } : {}),
      }),
    });
  }

  return undefined;
}
