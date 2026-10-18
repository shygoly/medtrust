import type { ContractBundleCardMessage } from '../types';

export interface ContractBundleCardProps {
  card: ContractBundleCardMessage;
  onSubmit: (values: Record<string, unknown>) => void;
  disabled?: boolean;
  className?: string;
}

const STATE_LABEL: Record<ContractBundleCardMessage['requirements'][number]['state'], string> = {
  ready: '已就绪',
  missing: '缺少合约',
  'not-usable': '尚不可用',
  'purpose-mismatch': '用途不符',
  unknown: '待复核',
};

export function ContractBundleCard({
  card,
  onSubmit,
  disabled,
  className,
}: ContractBundleCardProps) {
  return (
    <section
      className={className ?? 'rounded-lg border border-slate-300 bg-white p-4'}
      data-card-type="contract_bundle"
      data-card-title={card.title}
      data-bundle-id={card.bundleId}
    >
      <header className="mb-3">
        <h3 className="text-base font-semibold text-slate-900">{card.title}</h3>
        {card.description ? <p className="mt-1 text-sm text-slate-500">{card.description}</p> : null}
      </header>
      <div className="space-y-2">
        {card.requirements.map((requirement) => (
          <div
            key={`${requirement.role}:${requirement.participantId}:${requirement.dataProductId}`}
            className="rounded-md border border-slate-200 p-3"
            data-requirement-role={requirement.role}
            data-requirement-state={requirement.state}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium text-slate-900">
                  {requirement.role} · {requirement.participantId}
                </div>
                <div className="mt-1 break-all text-xs text-slate-500">
                  {requirement.dataProductId}
                  {requirement.contractId ? ` · ${requirement.contractId}` : ''}
                </div>
                {requirement.reason ? (
                  <p className="mt-2 text-xs text-slate-600">{requirement.reason}</p>
                ) : null}
              </div>
              <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                {STATE_LABEL[requirement.state]}
              </span>
            </div>
            {requirement.state !== 'ready' && requirement.request ? (
              <button
                type="button"
                className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                disabled={disabled}
                data-testid={`request-contract-${requirement.role}`}
                onClick={() => onSubmit(requirement.request ?? {})}
              >
                申请该成员合约
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
