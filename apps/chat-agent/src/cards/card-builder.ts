import type {
  ContractApprovalCardMessage,
  ContractCardSummary,
  ContractRequestCardMessage,
  CardMessage,
  FormCardMessage,
  FormField,
} from '@medtrust/chat-cards';
import { CARD_FENCE } from '@medtrust/chat-cards';
import { findScenario, SCENARIOS, type ScenarioBuildContext } from '../agent/scenarios';

/** 把一张卡渲染成 LLM 文本里的围栏块（前端与服务端共用同一套解析）。 */
export function renderCardFence(card: CardMessage): string {
  return ['```' + CARD_FENCE, JSON.stringify(card, null, 2), '```'].join('\n');
}

const assumption = (ctx: ScenarioBuildContext): string => {
  return `参数确认后会按逐数据源依赖检查合约；默认作业窗口 ${ctx.defaults.notBefore.slice(0, 10)} ~ ${ctx.defaults.notAfter.slice(0, 10)}，最小单元格 ${ctx.defaults.minCell}。`;
};

export interface BuildCardOptions {
  scenarioId: string;
  ctx: ScenarioBuildContext;
  /** 卡片标题覆盖（多轮修正时用） */
  title?: string;
  /** 预填值：提交失败后把用户填过的值放回卡片，改完直接再提交（tasks 3.4.3） */
  defaultValues?: Record<string, unknown>;
}

/** 场景 → FormCard。目录为空时 select 无候选项，卡片里会显式提示。 */
export function buildScenarioFormCard(options: BuildCardOptions): FormCardMessage | null {
  const scenario = findScenario(options.scenarioId);
  if (!scenario) return null;
  const missingDirectory =
    options.ctx.directory.participants.length === 0 && options.ctx.directory.dataProducts.length === 0;
  // 目录不可用时，下拉没有候选 → 降级为文本输入，用户可直接填 id（不让卡片变成死卡）。
  const prefilled = options.defaultValues ?? {};
  const fields: FormField[] = scenario.buildFields(options.ctx).map((field) => {
    const withValue: FormField =
      field.name in prefilled ? { ...field, defaultValue: prefilled[field.name] } : field;
    return withValue.type === 'select' && (withValue.options ?? []).length === 0
      ? {
          ...withValue,
          type: 'text' as const,
          help: [withValue.help, '（目录为空，请直接填写参与方/数据产品 id）']
            .filter(Boolean)
            .join(' '),
        }
      : withValue;
  });
  return {
    type: 'form',
    title: options.title ?? `${scenario.title} · 参数配置`,
    description: [scenario.description, assumption(options.ctx), missingDirectory ? '⚠️ 目录为空：请先确认参与方与数据产品已登记。' : '']
      .filter(Boolean)
      .join('\n'),
    scenario: scenario.id,
    fields,
  };
}

export function buildScenarioListCard(): CardMessage {
  return {
    type: 'result',
    title: '可用的计算场景',
    description: '说出你的数据与目标，我帮你选一个；也可以直接点名场景。',
    data: Object.fromEntries(
      SCENARIOS.map((scenario) => [scenario.title, scenario.description]),
    ),
  };
}

export function buildStatusCard(title: string, tone: CardMessage['tone'], data: Record<string, unknown>): CardMessage {
  return { type: 'status', title, tone, data };
}

export function buildErrorCard(title: string, message: string, suggestions: string[] = []): CardMessage {
  return {
    type: 'status',
    title,
    tone: 'error',
    description: [message, ...suggestions].join('\n'),
  };
}

export function buildResultCard(title: string, data: Record<string, unknown>): CardMessage {
  return { type: 'result', title, data };
}

export interface ContractProductRef {
  participantId: string;
  dataProductId: string;
  name?: string;
}

export interface ContractApprovalCardInput {
  title?: string;
  description?: string;
  providerId?: string;
  consumerId?: string;
  purpose: string;
  dataProducts: ContractProductRef[];
  validDays?: number;
  /** 用户点"同意并提交申请"时回灌给 `request_contract` 的入参 */
  request: Record<string, unknown>;
}

/**
 * 合约审批卡。
 *
 * `autoApprove` 恒为 false：本仓控制面没有"平台自动批准"路径（合约由数据提供方签发），
 * 卡片必须如实说明，否则用户会以为点完就有授权了。
 */
export function buildContractApprovalCard(
  input: ContractApprovalCardInput,
): ContractApprovalCardMessage {
  const contract: ContractCardSummary = {
    purpose: input.purpose,
    dataProducts: input.dataProducts,
    autoApprove: false,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.consumerId ? { consumerId: input.consumerId } : {}),
    ...(input.validDays ? { validDays: input.validDays } : {}),
    request: input.request,
  };
  return {
    type: 'contract_approval',
    title: input.title ?? '数据合约申请审批',
    description:
      input.description ??
      '这份作业涉及的数据还没有可用的数据合约。我可以以你的身份发起合约申请，由数据提供方签发。',
    contract,
    metadata: { tool: 'request_contract', ...(input.providerId ? { providerId: input.providerId } : {}) },
  };
}

export interface ContractRequestCardInput {
  title?: string;
  description?: string;
  reason: string;
  steps?: string[];
  contract?: ContractCardSummary;
}

export function buildContractRequestCard(
  input: ContractRequestCardInput,
): ContractRequestCardMessage {
  return {
    type: 'contract_request',
    title: input.title ?? '需要先完成合约申请的前置步骤',
    ...(input.description ? { description: input.description } : {}),
    reason: input.reason,
    ...(input.steps?.length ? { steps: input.steps } : {}),
    ...(input.contract ? { contract: input.contract } : {}),
  };
}

export interface ContractProgressRow {
  contractId: string;
  dataProductId: string;
  providerId: string;
  state: 'ready' | 'pending_issuance' | 'not-usable';
  waitingHours: number | null;
  slaBreached: boolean;
}

/**
 * 合约申请进度卡（Phase 4.4）。
 *
 * 让用户问一句就能看到"我那份申请到哪了、等了多久、有没有超 24h"——
 * 而不是靠"等签发"一句模糊回答。`waitingHours` 为 null 表示控制面没给申请时间（未知，不编 0）。
 */
export function buildContractProgressCard(rows: ContractProgressRow[]): CardMessage {
  if (rows.length === 0) {
    return {
      type: 'status',
      title: '还没有合约申请',
      tone: 'info',
      description: '当前没有你可见的合约申请。需要时我可以帮你发起一份。',
    };
  }
  const pending = rows.filter((row) => row.state === 'pending_issuance');
  const ready = rows.filter((row) => row.state === 'ready');
  const breached = rows.filter((row) => row.slaBreached);
  const lines = rows.map((row) => {
    const state =
      row.state === 'ready' ? '已就绪' : row.state === 'pending_issuance' ? '待提供方签发' : '不可用';
    const waited =
      row.waitingHours === null ? '等待时长未知' : `已等 ${row.waitingHours} 小时`;
    const flag = row.slaBreached ? '（超过 24 小时，建议联系提供方）' : '';
    return `${row.contractId} · ${row.dataProductId} · ${state} · ${waited}${flag}`;
  });
  return {
    type: 'status',
    title: '合约申请进度',
    tone: breached.length > 0 ? 'warning' : pending.length > 0 ? 'pending' : 'success',
    description: lines.join('\n'),
    data: {
      待签发: pending.length,
      已就绪: ready.length,
      ...(breached.length > 0 ? { 超过24小时: breached.length } : {}),
    },
  };
}

/** 合约申请提交后的状态卡（data 里有 contractId，便于后续查状态）。 */
export function buildContractPendingCard(input: {
  contractId: string;
  status: string;
  providerId?: string;
  /** 自动推进时的补充说明（例如"已按预授权自动发出要约"） */
  note?: string;
}): CardMessage {
  return {
    type: 'status',
    title: '合约申请已提交',
    tone: 'pending',
    description:
      '申请已递交给数据提供方。对方签发前这份合约不能用于提交作业——签发后回来重新配置任务即可。' +
      (input.note ? `\n${input.note}` : ''),
    data: {
      contractId: input.contractId,
      status: input.status,
      ...(input.providerId ? { providerId: input.providerId } : {}),
    },
  };
}

/**
 * 合约**已就绪**（Phase 3 自动创建）：预授权 + 院内自动签在用户无感的情况下走完了。
 *
 * 与 pending 卡刻意分开：pending 是"还要等别人"，ready 是"现在就能用"——
 * 把两者混成一张卡会让用户不知道该不该继续。
 */
export function buildContractReadyCard(input: {
  contractId: string;
  providerId?: string;
}): CardMessage {
  return {
    type: 'status',
    title: '合约已自动生效',
    tone: 'success',
    description:
      '基于数据提供方的预授权，合约已自动创建并完成签署（院内连接器按本地策略签的）。'
      + '现在可以直接配置并提交任务。',
    data: {
      contractId: input.contractId,
      status: 'active',
      ...(input.providerId ? { providerId: input.providerId } : {}),
    },
  };
}
