import type { ContractApprovalCardMessage } from '../types';
import { DEFAULT_CONTRACT_APPROVAL_ACTIONS } from '../types';

export interface ContractApprovalCardProps {
  card: ContractApprovalCardMessage;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 点"同意并提交申请"时回灌的取值：`action` 标记 + 卡片自带的申请入参。
 *
 * 抽成纯函数是为了**能被测**：`react-dom/server` 不跑 onClick，交互契约就只剩
 * "读源码才知道"。这里钉住"回灌什么"，后端 `request_contract` 的入参随之确定。
 */
export function contractApprovalSubmission(
  card: ContractApprovalCardMessage,
): Record<string, unknown> {
  return { action: 'request_contract', ...(card.contract.request ?? {}) };
}

/**
 * 合约审批卡。
 *
 * 展示"将要以你的身份发起一份什么合约申请"，而不是"合约已创建"：控制面里数字合约
 * 要等数据提供方签发才 active（`mdopStatus=active` + 持有方签名），卡片必须如实说清，
 * 否则用户会以为点完就有授权了。
 */
export function ContractApprovalCard({
  card,
  onSubmit,
  onCancel,
  disabled,
  className,
}: ContractApprovalCardProps) {
  const actions = card.actions?.length ? card.actions : DEFAULT_CONTRACT_APPROVAL_ACTIONS;
  const { contract } = card;
  const parties = [contract.consumerId, contract.providerId].filter(
    (party): party is string => typeof party === 'string' && party.length > 0,
  );

  return (
    <section
      className={className ?? 'rounded-lg border border-amber-200 bg-white p-4'}
      data-card-type="contract_approval"
      data-card-title={card.title}
      data-contract-id={contract.contractId}
    >
      <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
      {card.description ? (
        <p className="mt-1 text-sm text-slate-500">{card.description}</p>
      ) : null}

      <dl className="mt-3 grid gap-2 text-sm">
        {parties.length > 0 ? (
          <div className="flex gap-2">
            <dt className="text-slate-500">参与方</dt>
            <dd className="font-medium text-slate-900">{parties.join(' ↔ ')}</dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="text-slate-500">用途</dt>
          <dd className="font-medium text-slate-900">{contract.purpose}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-slate-500">涉及数据产品</dt>
          <dd className="font-medium text-slate-900">
            <ul className="space-y-1">
              {contract.dataProducts.map((product) => (
                <li key={`${product.participantId}:${product.dataProductId}`}>
                  {product.name ?? product.dataProductId}（{product.participantId}）
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {contract.validDays ? (
          <div className="flex gap-2">
            <dt className="text-slate-500">有效期</dt>
            <dd className="font-medium text-slate-900">{contract.validDays} 天</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
        ⚠️{' '}
        {contract.autoApprove
          ? '提交后立即生效。'
          : '提交后由数据提供方签发，签发完成前作业无法提交（可随时回来查状态）。'}
      </p>

      <footer className="mt-4 flex justify-end gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            data-action={action.type}
            data-testid={action.type === 'submit' ? 'submit-card' : undefined}
            disabled={disabled}
            className={
              action.variant === 'primary'
                ? 'rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50'
                : 'rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-50'
            }
            onClick={() => {
              if (action.type === 'submit') {
                onSubmit(contractApprovalSubmission(card));
              } else {
                onCancel?.();
              }
            }}
          >
            {action.label}
          </button>
        ))}
      </footer>
    </section>
  );
}
