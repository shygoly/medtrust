import type { ToolResult } from '@medtrust/pi-agent';
import type { AuditEntryInput } from '../../agent/tools/api-client';

/** 一条合规判定记录（进指标与结构化审计日志）。 */
export interface ComplianceAuditRecord {
  /** 判定值：ready / needs_permission / needs_contract / unknown / contract_requested / … */
  verdict: string;
  action: 'job_submit' | 'contract_request';
  scenario: string;
  tool: string;
  contractId?: string;
  /**
   * 合约自动推进的结果（仅 `request_contract` 有）：`ready` = 预授权 + 院内自动签完成，
   * `offered` = 已发要约但未签（连接器策略/时机），`skipped` = 未预授权或控制面拒绝自动推进。
   * 这是 plan 5.2「合约创建成功率」的分项口径。
   */
  autoOffer?: 'ready' | 'offered' | 'skipped';
  /**
   * 要写进**平台审计链**的条目（`POST /audit`）。
   *
   * 与指标/日志分开：指标是聚合计数，审计链是"可归属、可导出、带 SM3 链"的记录。
   * 映射在这里做一次，避免调用方各自拼 payload（拼法漂移 = 审计口径漂移）。
   */
  entry: AuditEntryInput;
}

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * 从工具结果里提取合规判定，供指标与审计使用（plan Phase 5）。
 *
 * 只在工具**真的做了合规判定**时返回记录：
 * - submit 工具：成功时带 `compliance.status`（ready/unknown），被拦时同样是这个字段；
 * - `request_contract`：成功是 `contract_requested`，失败按 `contractRequest.fix` 记（缺预审/缺登录态/…）。
 *
 * 契约依赖 `ToolResult.data` 里的这几个字段——它们是工具层与 observability 之间唯一的约定，
 * 所以有专门的用例把两侧钉在一起（工具改了字段名而这里没改，用例会红）。
 */
export function complianceAudit(
  toolName: string,
  scenario: string,
  result: ToolResult | undefined,
  /** 会话 id 由服务层传入（工具结果里没有；审计要能追到"哪一轮对话"） */
  sessionId?: string,
): ComplianceAuditRecord | null {
  const data = asObject(result?.data);

  if (toolName === 'request_contract') {
    const fix = asObject(data.contractRequest).fix;
    const verdict =
      result?.success === true
        ? 'contract_requested'
        : typeof fix === 'string'
          ? fix
          : 'contract_request_failed';
    const contractId = typeof data.contractId === 'string' ? data.contractId : undefined;
    const details = {
      source: 'ai-chat-agent',
      ...(sessionId ? { sessionId } : {}),
      ...(contractId ? { contractId } : {}),
      ...(typeof data.status === 'string' ? { status: data.status } : {}),
      ...(typeof asObject(data.contractRequest).compositionId === 'string'
        ? { compositionId: String(asObject(data.contractRequest).compositionId) }
        : {}),
      verdict,
    };
    const autoOffer =
      result?.success === true
        ? data.status === 'active' && data.autoOffered === true
          ? 'ready'
          : data.autoOffered === true
            ? 'offered'
            : 'skipped'
        : 'skipped';
    return {
      verdict,
      action: 'contract_request',
      scenario,
      tool: toolName,
      autoOffer,
      ...(contractId ? { contractId } : {}),
      // 申请成功 = 平台里真的多了一份草稿合约（CREATE）；
      // 被前置条件挡住 = 什么都没发生，按"查阅与判定"记（READ）。
      entry: {
        action: result?.success === true ? 'CREATE' : 'READ',
        resource: 'contract',
        details,
      },
    };
  }

  const compliance = asObject(data.compliance);
  const verdict = typeof compliance.status === 'string' ? compliance.status : undefined;
  if (!verdict) return null;
  const contractId =
    typeof compliance.contractId === 'string'
      ? compliance.contractId
      : typeof data.contractId === 'string'
        ? data.contractId
        : undefined;
  return {
    verdict,
    action: 'job_submit',
    scenario,
    tool: toolName,
    ...(contractId ? { contractId } : {}),
    entry:
      result?.success === true
        ? {
            // 作业真的提交了：动作是 COMPUTE，资源是 rws-task；合约 id 一并留档（plan 5.1）
            action: 'COMPUTE',
            resource: 'rws-task',
            details: {
              source: 'ai-chat-agent',
              ...(sessionId ? { sessionId } : {}),
              scenario,
              ...(typeof data.jobId === 'string' ? { jobId: data.jobId } : {}),
              ...(typeof data.template === 'string' ? { template: data.template } : {}),
              contractId: contractId ?? null,
              verdict,
            },
          }
        : {
            // 被合规闸拦下：动作没发生，记"判定"本身（含原因对应的 verdict 与合约 id）
            action: 'READ',
            resource: 'compliance-gate',
            details: {
              source: 'ai-chat-agent',
              ...(sessionId ? { sessionId } : {}),
              scenario,
              verdict,
              contractId: contractId ?? null,
              ...(typeof compliance.fix === 'string' ? { fix: compliance.fix } : {}),
            },
          },
  };
}
