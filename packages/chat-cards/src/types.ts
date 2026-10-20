/**
 * Card Message 协议类型（spec.md §7.3）。
 * 本文件为纯类型/纯逻辑，不得引入 React。
 */

export type CardType =
  | 'form'
  | 'status'
  | 'result'
  | 'confirm'
  /** 数据合约审批：用户确认后才发起合约申请（合规集成 Phase 3） */
  | 'contract_approval'
  /** 合约申请引导：当前身份不能自行发起时，告诉用户缺什么、找谁（Phase 4） */
  | 'contract_request'
  /** 多数据源合约包：逐行展示成员状态，并按依赖分别申请 */
  | 'contract_bundle'
  /** 可编辑的合约申请单：字段 + 合规预审选择 */
  | 'contract_apply'
  /** 统一入口的助手意图选择 */
  | 'assistant_intent';

export type FormFieldType = 'text' | 'number' | 'select' | 'date' | 'checkbox';

export type CardTone = 'info' | 'success' | 'warning' | 'error' | 'pending';

export interface FormFieldOption {
  label: string;
  value: string;
}

export interface FormFieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  placeholder?: string;
  help?: string;
  options?: FormFieldOption[];
  required?: boolean;
  defaultValue?: unknown;
  validation?: FormFieldValidation;
}

export interface CardAction {
  label: string;
  type: 'submit' | 'cancel' | 'back';
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface CardMessage {
  type: CardType;
  title: string;
  description?: string;
  fields?: FormField[];
  data?: Record<string, unknown>;
  actions?: CardAction[];
  tone?: CardTone;
  /** 场景 id（如 external-control / load-forecast），提交时回灌给后端做路由 */
  scenario?: string;
  /**
   * 机器可读附注（不渲染为正文）。
   *
   * 用于把「这张卡背后是哪个合约」这类事实随卡片一起传递：任务配置卡带上
   * `contractId` 后，用户与审计都能从卡片本身对齐"这次作业用了哪份授权"。
   */
  metadata?: Record<string, unknown>;
}

export interface FormCardMessage extends CardMessage {
  type: 'form';
  fields: FormField[];
}

export interface StatusCardMessage extends CardMessage {
  type: 'status';
}

export interface ResultCardMessage extends CardMessage {
  type: 'result';
}

export interface ConfirmCardMessage extends CardMessage {
  type: 'confirm';
}

/** 合约卡片里展示的合约摘要（发起申请前 / 后都够用）。 */
export interface ContractCardSummary {
  /** 合约（或申请草稿）id */
  contractId?: string;
  /** 数据提供方（本仓：医院/供电局等持有方） */
  providerId?: string;
  /** 数据使用方（发起申请的一方） */
  consumerId?: string;
  purpose: string;
  dataProducts: Array<{ participantId: string; dataProductId: string; name?: string }>;
  /** 有效期（天） */
  validDays?: number;
  /**
   * 是否提交即生效。
   *
   * **本仓控制面的现状恒为 false**：数字合约由数据提供方签发后才 active，
   * 不存在"平台自动批准"路径。字段保留是为了让 UI 如实说明"需对方签发"，
   * 而不是替控制面承诺一个不存在的自动批准（见 plan 的 Phase 3 偏差说明）。
   */
  autoApprove: boolean;
  /** 发起申请时要回灌给工具的入参（用户点"同意并提交申请"时原样带回） */
  request?: Record<string, unknown>;
}

export interface ContractApprovalCardMessage extends CardMessage {
  type: 'contract_approval';
  contract: ContractCardSummary;
}

/** 可编辑的合约申请卡：提交后交给 request_contract。 */
export interface ContractApplyCardMessage extends CardMessage {
  type: 'contract_apply';
  contract: ContractCardSummary;
  /** 没有可用的合规预审时显示的创建入口 */
  preReviewUrl?: string;
}

export interface ContractRequestCardMessage extends CardMessage {
  type: 'contract_request';
  /** 为什么不能自行发起（人话，可直接展示） */
  reason: string;
  /** 用户需要做的动作（有序） */
  steps?: string[];
  contract?: ContractCardSummary;
}

export interface ContractBundleRequirement {
  role: string;
  participantId: string;
  dataProductId: string;
  state: 'ready' | 'missing' | 'not-usable' | 'purpose-mismatch' | 'unknown';
  contractId?: string;
  reason?: string;
  request?: Record<string, unknown>;
}

export interface ContractBundleCardMessage extends CardMessage {
  type: 'contract_bundle';
  requirements: ContractBundleRequirement[];
  bundleId?: string;
  bundleVersion?: string;
}

export interface AssistantIntentOption {
  intent: string;
  title: string;
  summary: string;
}

export interface AssistantIntentCardMessage extends CardMessage {
  type: 'assistant_intent';
  data: {
    options: AssistantIntentOption[];
    evidence?: string[];
  };
}

/** 前端把表单值回灌为一条用户消息时的信封。 */
export interface CardSubmission {
  kind: 'card-submit';
  cardType: CardType;
  title: string;
  scenario?: string;
  values: Record<string, unknown>;
}

export const CARD_FENCE = 'card';
export const CARD_SUBMIT_PREFIX = '[card:submit]';

export const DEFAULT_FORM_ACTIONS: CardAction[] = [
  { label: '提交', type: 'submit', variant: 'primary' },
];

export const DEFAULT_CONFIRM_ACTIONS: CardAction[] = [
  { label: '确认提交', type: 'submit', variant: 'primary' },
  { label: '返回修改', type: 'back', variant: 'secondary' },
];

/**
 * 合约审批卡的默认动作。
 *
 * 文案刻意是"同意并提交申请"而不是"同意并创建"：点下去发生的是**发起申请**
 * （控制面 `POST /contracts/requests`），合约是否生效取决于数据提供方签发。
 * 按钮说成"创建"会让用户以为已经拿到授权了。
 */
export const DEFAULT_CONTRACT_APPROVAL_ACTIONS: CardAction[] = [
  { label: '同意并提交申请', type: 'submit', variant: 'primary' },
  { label: '取消', type: 'cancel', variant: 'secondary' },
];
