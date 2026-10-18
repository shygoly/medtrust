import type { ContractRequestCardMessage } from '../types';

export interface ContractRequestCardProps {
  card: ContractRequestCardMessage;
  onCancel?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 合约申请引导卡。
 *
 * 用在"这一步 agent 替不了你"的场合：当前身份不是数据使用方、或还没有可引用的合规预审。
 * 这类卡**不给提交按钮**——给了也只会失败；它给的是路径（去哪、找谁、需要什么）。
 */
export function ContractRequestCard({ card, onCancel, disabled, className }: ContractRequestCardProps) {
  const steps = card.steps ?? [];
  return (
    <section
      className={className ?? 'rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900'}
      data-card-type="contract_request"
      data-card-title={card.title}
    >
      <h3 className="text-base font-semibold">{card.title}</h3>
      {card.description ? <p className="mt-1">{card.description}</p> : null}
      <p className="mt-2 font-medium">{card.reason}</p>

      {steps.length > 0 ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}

      {card.contract ? (
        <dl className="mt-3 grid gap-1">
          <div className="flex gap-2">
            <dt className="text-sky-700">用途</dt>
            <dd className="font-medium">{card.contract.purpose}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-sky-700">数据产品</dt>
            <dd className="font-medium">
              {card.contract.dataProducts
                .map((product) => `${product.name ?? product.dataProductId}（${product.participantId}）`)
                .join('、')}
            </dd>
          </div>
        </dl>
      ) : null}

      {onCancel ? (
        <footer className="mt-4 flex justify-end">
          <button
            type="button"
            data-action="cancel"
            disabled={disabled}
            className="rounded-md border border-sky-300 px-4 py-2 text-sm text-sky-800 disabled:opacity-50"
            onClick={onCancel}
          >
            知道了
          </button>
        </footer>
      ) : null}
    </section>
  );
}
