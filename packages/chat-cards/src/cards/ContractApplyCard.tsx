import type { ContractApplyCardMessage } from '../types';
import { FormCard } from './FormCard';

export interface ContractApplyCardProps {
  card: ContractApplyCardMessage;
  onSubmit: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 合约申请单：字段由服务端生成（数据产品/提供方/合规预审来自目录与预审列表），
 * 用户只填条款；提交时把 action 与合约标识一起回灌给 request_contract。
 */
export function ContractApplyCard({
  card,
  onSubmit,
  disabled,
  className,
}: ContractApplyCardProps) {
  const { contract } = card;
  const dataProductId = contract.dataProducts[0]?.dataProductId ?? '';
  return (
    <div className={className} data-card-type="contract_apply">
      <FormCard
        card={{
          type: 'form',
          title: card.title,
          description:
            card.description ??
            `向 ${contract.providerId} 申请 ${dataProductId}；提交后生成待签发合约。`,
          fields: card.fields ?? [],
          actions: card.actions,
        }}
        disabled={disabled}
        onSubmit={(values) =>
          onSubmit({
            action: 'request_contract',
            dataProductId,
            providerId: contract.providerId,
            ...values,
            ...(contract.contractId ? { contractId: contract.contractId } : {}),
          })
        }
      />
      {card.preReviewUrl ? (
        <p className="mt-2 text-xs text-slate-500">
          还没有可用的合规预审？
          <a className="ml-1 underline" href={card.preReviewUrl}>
            去创建合规预审
          </a>
        </p>
      ) : null}
    </div>
  );
}
