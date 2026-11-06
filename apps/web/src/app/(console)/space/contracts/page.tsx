"use client";

import Link from "next/link";
import { ArrowRight, Gavel } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/console/ui";
import { AsyncBoundary } from "@/components/console/data";
import { RequestContractButton } from "@/components/console/request-contract-button";
import { IssueContractButton } from "@/components/console/issue-contract-button";
import { ContractRowActions } from "@/components/console/contract-row-actions";
import { C2PolicyPanel } from "@/components/console/c2-policy-panel";
import { RoleGate } from "@/components/console/role-gate";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import {
  REVIEW_FACETS,
  REVIEW_STATE_META,
  appliedAt,
  defaultFacet,
  expiryBadge,
  facetCounts,
  facetOf,
  formatTime,
  mdopHint,
  orgLabel,
  personLabel,
  preReviewLabel,
  reviewStateLabel,
  reviewStateOf,
  type ContractRow,
  type ReviewState,
} from "@/lib/contract-review";

/**
 * 数字合约（审核视角）。
 *
 * 一行只回答五件事：**谁（机构+人）→ 申请了什么数据集 → 用于什么目的 → 什么时候 → 现在什么状态**；
 * 已审结的再加一行「谁在什么时候审的」。留存/输出/预审/哈希等条款收进「条款细节」，默认不展开。
 * 状态口径统一走 lib/contract-review（revoked 要拆成驳回 / 解除 / 未记录）。
 */
export default function ContractsPage() {
  const { user } = useAuth();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [facet, setFacet] = useState<ReviewState | null>(null);
  useEffect(() => {
    setFocusId(new URLSearchParams(window.location.search).get("focus"));
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["contracts"],
    queryFn: () => api.listContracts(),
  });

  const { data: flTasks } = useQuery({
    queryKey: ["fl-prediction-tasks"],
    queryFn: () => api.listFlPredictionTasks(),
  });

  // 防御：接口形状异常（非数组）时不炸整页；排序键一律转成字符串，
  // 避免后端字段类型漂移（例如日期被序列化成对象）让 localeCompare 抛异常。
  const rows = useMemo(() => (Array.isArray(data) ? (data as ContractRow[]) : []), [data]);
  const counts = useMemo(() => facetCounts(rows), [rows]);
  const activeFacet = facet ?? defaultFacet(user?.role, rows);
  const visible = useMemo(() => {
    const label = (row: ContractRow) => String(row.requestedBy?.at ?? row.createdAt ?? "");
    return rows
      .filter((row) => facetOf(row) === activeFacet)
      .sort((a, b) => label(b).localeCompare(label(a)));
  }, [rows, activeFacet]);

  const inferByContract = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of flTasks ?? []) {
      if (task.status !== "completed" && task.status !== "partial") continue;
      const hasBundle = Boolean((task.merged as { weightBundle?: unknown } | undefined)?.weightBundle);
      if (!hasBundle) continue;
      for (const contractId of task.contractIds ?? []) {
        if (!map.has(contractId)) map.set(contractId, task.taskId);
      }
    }
    return map;
  }, [flTasks]);

  return (
    <div>
      <PageHeader
        kicker="CONTRACTS · 数字合约"
        desc="药企提交申请（待审批，可自行撤回）→ 医院签发（已生效）。这一页按「机构 · 申请人 → 数据集 · 用途 · 时间 → 状态」看，已审结的标明谁在什么时候做的决定。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RoleGate roles={["consumer"]}>
              <Link href="/space/atlas/pre-review" className="cs-btn cs-btn-ghost" title="申请合约前须先有一份已裁决的合规预审">
                <Gavel size={15} /> 合规预审
              </Link>
              <RequestContractButton />
            </RoleGate>
            <RoleGate roles={["provider"]}>
              <IssueContractButton />
            </RoleGate>
          </div>
        }
      />

      <nav aria-label="按状态筛选" className="px-8 pt-6 flex flex-wrap items-center gap-2">
        {REVIEW_FACETS.map((id) => {
          const selected = activeFacet === id;
          const meta = REVIEW_STATE_META[id];
          return (
            <button
              key={id}
              type="button"
              title={meta.hint}
              className="cs-btn cs-btn-ghost text-sm"
              style={
                selected
                  ? { borderColor: meta.color, color: meta.color, background: "var(--cs-bg-2)" }
                  : undefined
              }
              aria-pressed={selected}
              onClick={() => setFacet(id)}
            >
              {meta.label}
              <span className="cs-mono ml-1.5" style={{ color: selected ? meta.color : "var(--cs-faint)" }}>
                {counts[id]}
              </span>
            </button>
          );
        })}
        <span className="ml-auto text-xs" style={{ color: "var(--cs-faint)" }}>
          共 {rows.length} 份 · 当前筛选 {counts[activeFacet]} 份
        </span>
      </nav>

      <div className="p-8 space-y-3">
        <AsyncBoundary
          loading={isLoading}
          error={error}
          empty={rows.length === 0}
          loadingText="装载合约…"
          errorText="无法连接 /contracts。"
          emptyText="暂无数字合约。"
        >
          {visible.length === 0 ? (
            <Panel className="px-6 py-10 text-center text-sm" style={{ color: "var(--cs-faint)" }}>
              这个状态下没有合约。
            </Panel>
          ) : (
            visible.map((contract) => (
              <ContractCard
                key={contract.id}
                contract={contract}
                currentUserId={user?.participantId}
                viewerRole={user?.role}
                focused={focusId === contract.id}
                inferTaskId={inferByContract.get(contract.id) ?? null}
              />
            ))
          )}
        </AsyncBoundary>
      </div>
    </div>
  );
}

function ContractCard({
  contract,
  currentUserId,
  viewerRole,
  focused,
  inferTaskId,
}: {
  contract: ContractRow;
  currentUserId?: string;
  viewerRole?: string;
  focused: boolean;
  inferTaskId: string | null;
}) {
  const [showTerms, setShowTerms] = useState(false);
  const state = reviewStateOf(contract);
  const chip = reviewStateLabel(contract);
  const applicant = personLabel(contract.requestedBy?.name, contract.requestedBy?.email);
  const decider = personLabel(contract.decision?.by?.name, contract.decision?.by?.email);
  const revoker = personLabel(contract.revocation?.by?.name, contract.revocation?.by?.email);
  const hint = mdopHint(contract);
  const expiry = expiryBadge(contract);
  const canRevoke =
    Boolean(currentUserId) &&
    contract.providerId === currentUserId &&
    state === "active";
  const canWithdraw =
    viewerRole === "consumer" &&
    Boolean(currentUserId) &&
    contract.consumerId === currentUserId &&
    state === "pending";
  // 药企的「下一步」：生效了就去发起任务；被驳回/撤回了就重新申请（预填原产品与提供方）。
  const isConsumerOwn =
    viewerRole === "consumer" &&
    Boolean(currentUserId) &&
    contract.consumerId === currentUserId;
  const canStartTask = isConsumerOwn && state === "active";
  const canReapply = isConsumerOwn && (state === "rejected" || state === "withdrawn");
  const preReview = preReviewLabel(contract.preReview?.verdict);

  return (
    <Panel
      className="px-6 py-4"
      style={focused ? { background: "var(--cs-panel-2)" } : undefined}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[280px] space-y-1.5">
          {/* 机构 · 申请人 → 数据集 */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{orgLabel(contract.consumerOrg, contract.consumerId)}</span>
            {applicant ? (
              <span className="text-xs" style={{ color: "var(--cs-dim)" }}>{applicant}</span>
            ) : (
              <span className="text-xs" style={{ color: "var(--cs-faint)" }}>申请人未记录（旧合约）</span>
            )}
            <ArrowRight size={13} style={{ color: "var(--cs-faint)" }} />
            <span className="text-sm font-medium" style={{ color: "var(--cs-cyan)" }}>
              {contract.dataProductTitle ?? contract.dataProductId}
            </span>
          </div>

          {/* 用途 · 申请时间 */}
          <div className="text-sm" style={{ color: "var(--cs-text)" }}>
            用途：{contract.purpose || "（未声明目的）"}
          </div>
          <div className="text-xs" style={{ color: "var(--cs-faint)" }}>
            申请时间：{appliedAt(contract) ?? "未记录（旧合约）"}
          </div>

          {/* 审结信息：谁在什么时候审的 */}
          {state === "active" && (
            <div className="text-xs" style={{ color: "var(--cs-dim)" }}>
              {contract.decision ? (
                <>
                  审核：{orgLabel(contract.providerOrg, contract.providerId)}
                  {decider ? ` · ${decider}` : ""} · {formatTime(contract.decision.at) ?? "时间未记录"}
                  {contract.decision.note ? (
                    <span style={{ color: "var(--cs-faint)" }}>（确认理由：{contract.decision.note}）</span>
                  ) : null}
                </>
              ) : (
                <span style={{ color: "var(--cs-faint)" }}>审核记录：未记录（旧合约）</span>
              )}
            </div>
          )}
          {state === "rejected" && (
            <div className="text-xs" style={{ color: "var(--cs-red)" }}>
              驳回：{orgLabel(contract.providerOrg, contract.providerId)}
              {decider ? ` · ${decider}` : ""} · {formatTime(contract.decision?.at) ?? "时间未记录"}
            </div>
          )}
          {state === "withdrawn" && (
            <div className="text-xs" style={{ color: "var(--cs-dim)" }}>
              撤回：{orgLabel(contract.consumerOrg, contract.consumerId)}
              {decider ? ` · ${decider}` : ""} · {formatTime(contract.decision?.at) ?? "时间未记录"}
              {contract.decision?.note ? (
                <span style={{ color: "var(--cs-faint)" }}>（原因：{contract.decision.note}）</span>
              ) : null}
            </div>
          )}
          {state === "terminated" && (
            <div className="text-xs" style={{ color: "var(--cs-dim)" }}>
              解除：{revoker ?? "未记录"} · {formatTime(contract.revocation?.at) ?? "时间未记录"}
              {contract.revocation?.reason ? ` · 原因：${contract.revocation.reason}` : ""}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {expiry && (
            <span className="cs-chip text-xs" style={{ borderColor: expiry.color, color: expiry.color }} title="到期后合约失效，需续签">
              {expiry.label}
            </span>
          )}
          {hint && (
            <span className="cs-chip text-xs" style={{ borderColor: "var(--cs-amber)", color: "var(--cs-amber)" }}>
              {hint}
            </span>
          )}
          <span className="cs-chip" style={{ borderColor: chip.color, color: chip.color }}>
            {chip.label}
          </span>
          <ContractRowActions
            contract={{
              id: contract.id,
              canApprove: contract.canApprove,
              canRevoke,
              canWithdraw,
              preReview: contract.preReview ?? null,
            }}
          />
          {canStartTask && (
            <Link
              href={`/space/tasks/new?contractId=${encodeURIComponent(contract.id)}`}
              className="cs-btn text-xs"
              title="带着这份合约去编排任务（合约已预选）"
            >
              <ArrowRight size={13} /> 用此合约发起任务
            </Link>
          )}
          {canReapply && (
            <RequestContractButton
              compact
              label="重新申请"
              dataProductId={contract.dataProductId}
              providerId={contract.providerId}
            />
          )}
        </div>
      </div>

      {/* 条款与证据：默认收起，保持一行只讲审核要看的事 */}
      <div className="mt-3">
        <button
          type="button"
          className="cs-label"
          aria-expanded={showTerms}
          onClick={() => setShowTerms((v) => !v)}
        >
          {showTerms ? "收起条款细节 ▲" : "条款与证据 ▼"}
        </button>
        {showTerms && (
          <div className="mt-2 grid gap-x-8 gap-y-1 text-xs md:grid-cols-2" style={{ color: "var(--cs-dim)" }}>
            <Term k="有效期至" v={formatTime(contract.validUntil)} />
            <Term k="留存" v={contract.retention} />
            <Term k="输出形态" v={contract.output} />
            <Term k="minCell" v={contract.outputPolicy?.minCell != null ? String(contract.outputPolicy.minCell) : null} />
            <Term
              k="合规预审"
              v={
                preReview
                  ? `${preReview}${contract.preReview?.overallRisk ? ` · 风险 ${contract.preReview.overallRisk}` : ""}${contract.preReview?.evaluatedAt ? ` · ${formatTime(contract.preReview.evaluatedAt)}` : ""}`
                  : "无（旧合约）"
              }
            />
            <Term
              k="固定算法模块"
              v={
                contract.pinnedModules && Object.keys(contract.pinnedModules).length
                  ? Object.keys(contract.pinnedModules).join("、")
                  : null
              }
            />
            <Term k="合约哈希" v={contract.hash ? `${contract.hash.slice(0, 24)}…` : null} mono />
            <Term k="链上存证" v={contract.attestationTxHash ? `${contract.attestationTxHash.slice(0, 24)}…` : null} mono />
          </div>
        )}
        {showTerms && state === "active" && (
          <div className="mt-3 space-y-3">
            {inferTaskId && (
              <Link
                href={`/space/infer/${encodeURIComponent(inferTaskId)}?contractId=${encodeURIComponent(contract.id)}`}
                className="cs-navlink text-xs inline-block"
                style={{ borderColor: "var(--cs-cyan)", color: "var(--cs-cyan)" }}
              >
                推理入口
              </Link>
            )}
            {/* C2 证明策略只对生效中的合约开放：改条款要各方重新签署 */}
            <C2PolicyPanel contractId={contract.id} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function Term({ k, v, mono = false }: { k: string; v?: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="cs-label">{k}</span>
      <span className={mono ? "cs-mono" : ""} style={{ color: v ? "var(--cs-text)" : "var(--cs-faint)" }}>
        {v || "未记录"}
      </span>
    </div>
  );
}
