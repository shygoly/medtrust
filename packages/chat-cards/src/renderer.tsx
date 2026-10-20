import type { CardMessage } from './types';
import type {
  AssistantIntentCardMessage,
  ContractApplyCardMessage,
  ContractApprovalCardMessage,
  ContractBundleCardMessage,
  ContractRequestCardMessage,
} from './types';
import {
  AssistantIntentCard,
  ConfirmCard,
  ContractApplyCard,
  ContractApprovalCard,
  ContractBundleCard,
  ContractRequestCard,
  FormCard,
  ResultCard,
  StatusCard,
} from './cards';

export interface CardRendererProps {
  card: CardMessage;
  onSubmit?: (values: Record<string, unknown>) => void;
  onCancel?: () => void;
  disabled?: boolean;
  className?: string;
}

export function CardRenderer({ card, onSubmit, onCancel, disabled, className }: CardRendererProps) {
  const submit = onSubmit ?? (() => undefined);
  switch (card.type) {
    case 'form':
      return (
        <FormCard
          card={{ ...card, type: 'form', fields: card.fields ?? [] }}
          onSubmit={submit}
          disabled={disabled}
          className={className}
        />
      );
    case 'confirm':
      return (
        <ConfirmCard
          card={{ ...card, type: 'confirm' }}
          onSubmit={submit}
          onCancel={onCancel}
          disabled={disabled}
          className={className}
        />
      );
    case 'contract_approval':
      // 校验层已经保证 contract 存在（服务端丢弃非法卡）；这里再兜一层，
      // 前端拿到历史里的旧卡或手搓卡时不至于白屏。
      if (!(card as ContractApprovalCardMessage).contract) {
        return <StatusCard card={{ ...card, type: 'status', tone: card.tone ?? 'warning' }} className={className} />;
      }
      return (
        <ContractApprovalCard
          card={{ ...(card as ContractApprovalCardMessage) }}
          onSubmit={submit}
          onCancel={onCancel}
          disabled={disabled}
          className={className}
        />
      );
    case 'contract_apply':
      return (
        <ContractApplyCard
          card={card as ContractApplyCardMessage}
          onSubmit={submit}
          disabled={disabled}
          className={className}
        />
      );
    case 'contract_request':
      return (
        <ContractRequestCard
          card={
            typeof (card as ContractRequestCardMessage).reason === 'string'
              ? { ...(card as ContractRequestCardMessage) }
              : {
                  ...card,
                  type: 'contract_request',
                  reason: '这份作业缺少可用的数据合约，需要先完成合约流程。',
                }
          }
          onCancel={onCancel}
          disabled={disabled}
          className={className}
        />
      );
    case 'contract_bundle':
      return (
        <ContractBundleCard
          card={card as ContractBundleCardMessage}
          onSubmit={submit}
          disabled={disabled}
          className={className}
        />
      );
    case 'assistant_intent':
      return (
        <AssistantIntentCard
          card={card as AssistantIntentCardMessage}
          onSubmit={submit}
          disabled={disabled}
          className={className}
        />
      );
    case 'result':
      return <ResultCard card={{ ...card, type: 'result' }} className={className} />;
    case 'status':
    default:
      return <StatusCard card={{ ...card, type: 'status' }} className={className} />;
  }
}
