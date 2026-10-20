import { Logger } from '@nestjs/common';
import type { Tool, ToolContext } from '@medtrust/pi-agent';
import { asChatContext } from '../context';
import { buildContractApplyCard, buildContractPendingCard, buildContractRequestCard } from '../../cards/card-builder';
import { buildContractReadyCard } from '../../cards/card-builder';
import { buildContractProgressCard, type ContractProgressRow } from '../../cards/card-builder';
import { isContractUsableById } from '../../compliance/compliance';
import type { MedTrustApiClient } from './api-client';
import type { ChatToolContext } from '../context';

const audit = new Logger('ComplianceAudit');

/** 合约申请缺什么（给 agent 出卡用，取值是封闭集合，便于提示词与测试对齐）。 */
export type ContractRequestFix =
  | 'sign_in'
  | 'create_pre_review'
  | 'choose_pre_review'
  | 'await_provider_approval'
  | 'request_contract_failed';

const REQUIRED_TEXT_FIELDS = ['dataProductId', 'purpose', 'retention', 'output'] as const;

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * 发起数字合约申请（合规集成 Phase 3）。
 *
 * **与 plan.md 的偏差（如实说明）**：plan 写的是"自动创建临时合约、可 autoApprove"。
 * 本仓控制面没有这条路：`POST /contracts/requests` 只接受**数据使用方**身份，且必须引用
 * 一份属于本方的合规预审（D-CMP-2）；生成的合约是 `draft`，必须由数据提供方签发
 * （`holderSignature` + `mdopStatus=active`）才能用于作业，`assertUsableForJob` 是硬闸。
 * 所以这个工具做的是**替用户把申请递出去**，不做"平台自动批准"——后者不存在，
 * 编一个出来只会让卡片替控制面说谎。
 *
 * 红线：入参只有数据产品 id、用途、留存、输出形态这类**治理字段**；不取数、不复述内容。
 */
/**
 * 把多数据源 bundle 里的一行翻译成可编辑的合约申请单。
 * 只读目录/预审，不创建合约；用户提交后才走 request_contract。
 */
export function buildPrepareContractApplyTool(api: MedTrustApiClient): Tool {
  return {
    name: 'prepare_contract_apply',
    description:
      '为一个数据源生成可编辑的合约申请卡：带数据产品、提供方、用途与合规预审选项。' +
      '调用后不会创建合约；用户填卡并提交后才会发起申请。',
    parameters: {
      type: 'object',
      properties: {
        dataProductId: { type: 'string' },
        providerId: { type: 'string' },
        purpose: { type: 'string' },
        retention: { type: 'string' },
        minCell: { type: 'number' },
        validDays: { type: 'number' },
      },
      required: ['dataProductId', 'providerId', 'purpose'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const raw = asObject(params);
      const dataProductId = text(raw.dataProductId);
      const providerId = text(raw.providerId);
      const purpose = text(raw.purpose);
      if (!dataProductId || !providerId || !purpose) {
        return { success: false, error: '缺少 dataProductId / providerId / purpose' };
      }
      if (!ctx.accessToken) {
        return { success: false, error: '解析合规预审需要当前用户登录凭证，请重新登录后重试。' };
      }
      const compositions = await api.listCompositions(ctx.accessToken).catch(() => []);
      const card = buildContractApplyCard({
        dataProductId,
        providerId,
        purpose,
        ...(text(raw.retention) ? { retention: text(raw.retention) } : {}),
        ...(typeof raw.minCell === 'number' ? { minCell: raw.minCell } : {}),
        ...(typeof raw.validDays === 'number' ? { validDays: raw.validDays } : {}),
        compositions: compositions.map((c) => ({ id: c.id, verdict: c.verdict })),
        preReviewUrl: '/space/atlas/pre-review',
      });
      return { success: true, data: { card } };
    },
  };
}

export function buildContractRequestTool(api: MedTrustApiClient): Tool {
  return {
    name: 'request_contract',
    description:
      '以当前用户（数据使用方）身份发起数字合约申请：需要 dataProductId、purpose、retention、output，' +
      '可选 compositionId（合规预审组合 id）与 validDays。返回的是**申请**（状态 draft），' +
      '合约要等数据提供方签发后才可用。缺合规预审时不要自己编 compositionId——把返回的 steps 交给用户。',
    parameters: {
      type: 'object',
      properties: {
        dataProductId: { type: 'string', description: '要申请的数据产品 id' },
        purpose: { type: 'string', description: '使用目的（人话，会写进合约）' },
        retention: { type: 'string', description: '数据留存要求（如"阅后即焚"）' },
        output: { type: 'string', description: '结果输出形态（如"仅聚合结果"）' },
        compositionId: { type: 'string', description: '合规预审组合 id（本方创建的）' },
        validDays: { type: 'number', description: '有效期（天），缺省 30' },
        minCell: { type: 'number', description: '最小单元格（缺省用空间默认值）' },
        /** 容错：把卡片回灌的 values 整体传进来时也能解析（模型偶尔会原样转手） */
        values: { type: 'object', description: '（兼容）卡片回灌的 values 对象' },
      },
      required: [],
    },
    execute: async (params, context: ToolContext) => {
      const ctx = asChatContext(context);
      const raw = { ...asObject(params), ...asObject((params as { values?: unknown })?.values) };
      if (text(raw.purpose) === '' && text(raw.purposeCode) !== '')
        raw.purpose = text(raw.purposeCode);

      const missing = REQUIRED_TEXT_FIELDS.filter((field) => text(raw[field]) === '');
      if (missing.length > 0) {
        return {
          success: false,
          error: `发起合约申请还缺：${missing.join('、')}`,
          data: { contractRequest: { fix: 'request_contract_failed', missing } },
        };
      }

      if (!ctx.accessToken) {
        return {
          success: false,
          error: '发起合约申请需要你的登录态（控制面按 JWT 判定申请方身份）',
          data: { contractRequest: { fix: 'sign_in' } },
        };
      }

      const validDaysRaw = Number(raw.validDays ?? 30);
      const validDays =
        Number.isFinite(validDaysRaw) && validDaysRaw >= 1 && validDaysRaw <= 365
          ? Math.floor(validDaysRaw)
          : 30;
      const minCellRaw = Number(raw.minCell);

      let compositionId = text(raw.compositionId);
      if (!compositionId) {
        let compositions: Awaited<ReturnType<MedTrustApiClient['listCompositions']>>;
        try {
          compositions = await api.listCompositions(ctx.accessToken);
        } catch (error) {
          audit.warn({
            event: 'compliance_audit',
            action: 'contract.request',
            outcome: 'pre_review_query_failed',
            userRef: ctx.userId,
            spaceId: ctx.spaceId,
            error: message(error),
          });
          return {
            success: false,
            error: `查询合规预审失败：${message(error)}`,
            data: { contractRequest: { fix: 'request_contract_failed' } },
          };
        }

        if (compositions.length === 0) {
          audit.log({
            event: 'compliance_audit',
            action: 'contract.request',
            outcome: 'blocked_no_pre_review',
            userRef: ctx.userId,
            spaceId: ctx.spaceId,
          });
          return {
            success: false,
            error: '本方还没有合规预审组合，合约申请必须先有预审（控制面 D-CMP-2）',
            data: {
              card: buildContractRequestCard({
                title: '还差一份合规预审',
                reason: '合约申请必须引用一份属于本方的合规预审（控制面 D-CMP-2），现在还没有。',
                steps: [
                  '在「合规预审」页创建组合并跑一次 L2 裁决',
                  '裁决不是 block 之后，回这里让我用该预审发起合约申请',
                  '或直接找数据提供方管理员签发合约',
                ],
              }),
              contractRequest: {
                fix: 'create_pre_review',
                steps: [
                  '在「合规预审」页创建组合并跑一次 L2 裁决',
                  '裁决不是 block 之后，回这里让我用该预审发起合约申请',
                  '或者直接找数据提供方管理员签发合约',
                ],
              },
            },
          };
        }

        if (compositions.length > 1) {
          const candidates = compositions.map((item) => ({
            compositionId: item.id,
            scenarioKey: item.scenarioKey ?? null,
            verdict: item.verdict ?? null,
          }));
          return {
            success: false,
            error: '本方有多份合规预审，需要指定用哪一份',
            data: {
              card: buildContractRequestCard({
                title: '选用哪一份合规预审？',
                reason: '本方有多份合规预审，合约申请要引用其中一份。',
                steps: candidates.map(
                  (candidate) =>
                    `用 ${candidate.compositionId}${candidate.scenarioKey ? `（${candidate.scenarioKey}）` : ''}` +
                    `${candidate.verdict ? `，最近裁决 ${candidate.verdict}` : ''}` +
                    ' —— 把该 id 告诉我即可',
                ),
              }),
              contractRequest: {
                fix: 'choose_pre_review',
                candidates,
              },
            },
          };
        }
        compositionId = compositions[0].id;
      }

      try {
        const created = await api.requestContract(
          {
            dataProductId: text(raw.dataProductId),
            compositionId,
            purpose: text(raw.purpose),
            retention: text(raw.retention),
            output: text(raw.output),
            validDays,
            ...(Number.isFinite(minCellRaw) && minCellRaw > 0 ? { minCell: minCellRaw } : {}),
          },
          { userId: ctx.userId, spaceId: ctx.spaceId, token: ctx.accessToken },
        );

        audit.log({
          event: 'compliance_audit',
          action: 'contract.request',
          outcome: 'submitted',
          userRef: ctx.userId,
          spaceId: ctx.spaceId,
          contractId: created.contractId,
          compositionId,
          providerId: created.providerId ?? null,
        });

        // ── Phase 3：预授权自动推进 ────────────────────────────────────────────
        // 提供方已按产品级 ACL 预授权该使用方时，平台可以把申请**定稿并发出要约**，
        // 不必等医院网页点签发；签名仍由院内连接器按本地策略给出（D-MDOP-4 不变）。
        const auto = await tryAutoOffer(api, ctx, created.contractId);
        if (auto.state === 'ready') {
          audit.log({
            event: 'compliance_audit',
            action: 'contract.auto-offer',
            outcome: 'ready',
            userRef: ctx.userId,
            spaceId: ctx.spaceId,
            contractId: created.contractId,
            grantId: auto.grantId,
          });
          return {
            success: true,
            data: {
              card: buildContractReadyCard({
                contractId: created.contractId,
                ...(created.providerId ? { providerId: created.providerId } : {}),
              }),
              contractId: created.contractId,
              status: 'active',
              requiresProviderApproval: false,
              autoOffered: true,
              fix: null,
              contractRequest: { fix: null, compositionId, autoOffered: true },
            },
          };
        }

        const autoPending = auto.state === 'offered';
        return {
          success: true,
          data: {
            card: buildContractPendingCard({
              contractId: created.contractId,
              status: created.status,
              ...(created.providerId ? { providerId: created.providerId } : {}),
              ...(autoPending
                ? { note: '已按提供方预授权自动发出要约，等其连接器确认（无需医院再点一次）' }
                : {}),
            }),
            contractId: created.contractId,
            status: created.status,
            requiresProviderApproval: created.requiresProviderApproval,
            autoOffered: autoPending,
            fix: 'await_provider_approval',
            contractRequest: {
              fix: 'await_provider_approval',
              compositionId,
              autoOffered: autoPending,
              ...(auto.state === 'skipped' && auto.reason ? { autoOfferSkipped: auto.reason } : {}),
            },
          },
        };
      } catch (error) {
        audit.warn({
          event: 'compliance_audit',
          action: 'contract.request',
          outcome: 'failed',
          userRef: ctx.userId,
          spaceId: ctx.spaceId,
          compositionId,
          error: message(error),
        });
        return {
          success: false,
          error: message(error),
          data: { contractRequest: { fix: 'request_contract_failed', compositionId } },
        };
      }
    },
  };
}

/** 审批进度 SLA：超过这个小时数就该提醒用户去催（plan 的成功指标：审批响应 < 24 小时）。 */
export const APPROVAL_SLA_HOURS = 24;

/**
 * 合约申请进度（Phase 4.4）：用户问"我的申请到哪了"时用。
 *
 * 只看**本人可见**的合约（控制面按调用者 role/participant 过滤），所以不需要 agent 自己
 * 判断"这是不是我的"——越权在控制面就被挡掉了。等待时长用合约的 `createdAt`（申请创建时间）
 * 算；控制面没给就如实说"未知"，不编 0。
 */
export function buildContractProgressTool(api: MedTrustApiClient): Tool {
  return {
    name: 'list_contract_requests',
    description:
      '列出本人可见的合约申请及进度（待提供方签发 / 已就绪），带等待时长与 24 小时 SLA 提示。' +
      '用户问"我的申请处理到哪了""还要等多久"时用它，不要凭印象回答。',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'ready', 'all'],
          description: '筛选：pending=还在等签发 / ready=可用 / all=全部（缺省 all）',
        },
      },
      required: [],
    },
    execute: async (params, context: ToolContext) => {
      const ctx = asChatContext(context);
      if (!ctx.accessToken) {
        return { success: false, error: '查询合约进度需要你的登录态' };
      }
      const status = String((params as { status?: unknown }).status ?? 'all');
      let contracts;
      try {
        contracts = await api.listContracts(ctx.accessToken);
      } catch (error) {
        return { success: false, error: `查询合约失败：${message(error)}` };
      }

      const now = Date.now();
      const rows: ContractProgressRow[] = contracts
        .map((contract) => {
          const ready = contract.holderSigned === true && contract.mdopStatus === 'active';
          const created = contract.createdAt ? Date.parse(contract.createdAt) : Number.NaN;
          const waitingHours = Number.isFinite(created)
            ? Math.max(0, Math.round(((now - created) / 3_600_000) * 10) / 10)
            : null;
          return {
            contractId: contract.id,
            dataProductId: contract.dataProductId ?? '',
            providerId: contract.providerId,
            state: ready ? 'ready' : contract.status === 'draft' ? 'pending_issuance' : 'not-usable',
            waitingHours,
            slaBreached: waitingHours !== null && waitingHours > APPROVAL_SLA_HOURS,
          } as ContractProgressRow;
        })
        .filter((row) =>
          status === 'pending'
            ? row.state === 'pending_issuance'
            : status === 'ready'
              ? row.state === 'ready'
              : true,
        );

      return {
        success: true,
        data: {
          card: buildContractProgressCard(rows),
          requests: rows,
          pending: rows.filter((row) => row.state === 'pending_issuance').length,
          ready: rows.filter((row) => row.state === 'ready').length,
          slaHours: APPROVAL_SLA_HOURS,
        },
      };
    },
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 尝试"预授权自动推进 + 等院内自动签"（Phase 3）。
 *
 * 三种结果，都如实回报：
 * - `ready`：合约已可用（院内连接器按本地策略自动签了）→ 可以直接配置任务；
 * - `offered`：要约已发出但还没签（连接器策略是人工复核，或还没跑完）→ 回"等签发";
 * - `skipped`：控制面拒绝自动推进（未预授权 / 预审需审批 / 没登录态）→ 维持原有人工路径。
 *
 * 轮询是**有界的**（默认 3 次 × 1s）：自动签是异步的（要约 → 长轮询 → 连接器签 → 回执），
 * 但把用户晾在一个无限等待里更糟；等不到就如实说"还在等对方确认"。
 */
async function tryAutoOffer(
  api: MedTrustApiClient,
  ctx: ChatToolContext,
  contractId: string,
  poll: { attempts?: number; delayMs?: number } = {},
): Promise<
  | { state: 'ready'; grantId: string }
  | { state: 'offered'; grantId: string }
  | { state: 'skipped'; reason: string }
> {
  if (!ctx.accessToken) return { state: 'skipped', reason: '未带调用者凭证' };
  let grantId = '';
  try {
    const result = await api.autoOfferContract(contractId, {
      userId: ctx.userId,
      spaceId: ctx.spaceId,
      token: ctx.accessToken,
    });
    grantId = result.grantId;
    if (!result.offered) return { state: 'offered', grantId };
  } catch (error) {
    // 未预授权 / 预审需审批 / 端点不可用：都退回人工路径（不阻断用户）
    return { state: 'skipped', reason: message(error) };
  }

  const attempts = poll.attempts ?? 3;
  const delayMs = poll.delayMs ?? 1_000;
  for (let i = 0; i < attempts; i += 1) {
    const usable = await isContractUsableById(api, ctx.accessToken, contractId).catch(() => false);
    if (usable) return { state: 'ready', grantId };
    if (i < attempts - 1) await sleep(delayMs);
  }
  return { state: 'offered', grantId };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
