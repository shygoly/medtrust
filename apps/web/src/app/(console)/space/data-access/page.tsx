"use client";

import { useMemo, useState } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/console/ui";
import { AsyncBoundary } from "@/components/console/data";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import {
  defaultGrantFacet,
  formatDate,
  grantState,
  grantStateLabel,
  granteeOptions,
  institutionName,
  isPendingRequest,
  permissionSummary,
  requestStatusLabel,
  type AccessGrantRow,
  type AccessPermission,
  type AccessRequestRow,
  type GrantState,
} from "@/lib/data-access";

/**
 * 数据授权（产品级 ACL，D-ACL-1）。
 *
 * 一页只做两件事：**授予** / **回收**。它回答「这家机构能不能碰这份数据产品」；
 * 以什么条款执行是数字合约的事，所以这里不出现留存/输出/用途条款。
 * 回收是追加式的：行变灰保留（授权史本身是审计证据）。
 */
const FACETS: GrantState[] = ["active", "expired", "revoked"];

export default function DataAccessPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canAdminister =
    user?.role === "provider" ||
    user?.role === "compliance" ||
    user?.role === "operator" ||
    user?.role === "admin";

  const [facetOverride, setFacetOverride] = useState<GrantState | null>(null);
  const [productFilter, setProductFilter] = useState("");
  const [showGrant, setShowGrant] = useState(false);
  const [msg, setMsg] = useState("");

  const grants = useQuery({
    queryKey: ["access-grants"],
    queryFn: () => api.listAccessGrants(),
  });
  const products = useQuery({
    queryKey: ["catalog", "data"],
    queryFn: () => api.getDataAssets("data"),
  });
  const institutions = useQuery({
    queryKey: ["institutions"],
    queryFn: () => api.listInstitutions(),
  });
  const requests = useQuery({
    queryKey: ["access-requests"],
    queryFn: () => api.listDataAccessRequests(),
  });

  const productRows = useMemo(
    () => ((products.data as any[] | undefined) ?? []).filter((p) => p?.id),
    [products.data],
  );
  const institutionRows = institutions.data?.items ?? [];

  const orgBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of institutionRows) {
      if (row.participantId) map.set(row.participantId, row.org);
    }
    return map;
  }, [institutionRows]);

  const productTitle = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of productRows) map.set(String(row.id), String(row.title ?? row.id));
    return map;
  }, [productRows]);

  const manageableProducts = useMemo(
    () =>
      productRows.filter((p) =>
        canAdminister && user?.role !== "provider" ? true : p.providerId === user?.participantId,
      ),
    [productRows, canAdminister, user?.role, user?.participantId],
  );

  const rows = useMemo(() => {
    const all = (grants.data ?? []) as AccessGrantRow[];
    return all
      .filter((row) => !productFilter || row.dataProductId === productFilter)
      .sort((a, b) => String(b.grantedAt ?? "").localeCompare(String(a.grantedAt ?? "")));
  }, [grants.data, productFilter]);

  // 使用方只能看到与自己相关的产品；管理方可以按全部产品筛选。
  const productOptions = useMemo(() => {
    if (canAdminister) return productRows;
    const granted = new Set(((grants.data ?? []) as AccessGrantRow[]).map((r) => r.dataProductId));
    return productRows.filter((p) => granted.has(String(p.id)));
  }, [canAdminister, productRows, grants.data]);

  const requestRows = useMemo(
    () => (requests.data ?? []) as AccessRequestRow[],
    [requests.data],
  );
  const pendingRequests = requestRows.filter(isPendingRequest);
  // 医院侧只看「待我批」；使用方看自己发起的全部（含已批准/被拒/撤回）。
  const showRequestSection = canAdminister || requestRows.length > 0;

  const counts = useMemo(() => {
    const c: Record<GrantState, number> = { active: 0, expired: 0, revoked: 0 };
    for (const row of rows) c[grantState(row)] += 1;
    return c;
  }, [rows]);

  // 默认落在有数据的那一档（例如只有一条已回收记录时，不先展示空列表）；
  // 用户点了分面后以用户选择为准。
  const facet = facetOverride ?? defaultGrantFacet(rows);
  const visible = rows.filter((row) => grantState(row) === facet);

  const approveRequest = async (row: AccessRequestRow) => {
    if (!window.confirm("批准后立即生成访问授权，该机构即可按权限位访问；确认批准？")) return;
    try {
      setMsg("批准中…");
      await api.approveDataAccessRequest(row.id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["access-requests"] }),
        queryClient.invalidateQueries({ queryKey: ["access-grants"] }),
      ]);
      setMsg("已批准并授予");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    }
  };

  const rejectRequest = async (row: AccessRequestRow) => {
    const reason = window.prompt("驳回原因（必填，会回到申请方）：", "");
    if (reason === null) return;
    if (!reason.trim()) {
      setMsg("驳回原因不可为空");
      return;
    }
    try {
      setMsg("驳回中…");
      await api.rejectDataAccessRequest(row.id, reason.trim());
      await queryClient.invalidateQueries({ queryKey: ["access-requests"] });
      setMsg("已驳回");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    }
  };

  const withdrawRequest = async (row: AccessRequestRow) => {
    if (!window.confirm("确认撤回这份访问申请？")) return;
    try {
      setMsg("撤回中…");
      await api.withdrawDataAccessRequest(row.id);
      await queryClient.invalidateQueries({ queryKey: ["access-requests"] });
      setMsg("已撤回");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    }
  };

  const revoke = async (row: AccessGrantRow) => {
    const reason = window.prompt(
      `回收 ${institutionName(orgBySlug, row.granteeParticipantId)} 对「${productTitle.get(row.dataProductId) ?? row.dataProductId}」的访问权。\n回收原因（必填，留痕）：`,
      "",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setMsg("回收原因不可为空");
      return;
    }
    if (!window.confirm("确认回收？回收后该机构将无法再按此授权访问；记录保留为审计证据。")) return;
    try {
      setMsg("回收中…");
      await api.revokeAccess(row.id, reason.trim());
      await queryClient.invalidateQueries({ queryKey: ["access-grants"] });
      setMsg("已回收");
    } catch (e: any) {
      setMsg(`失败: ${e?.message || "请求错误"}`);
    }
  };

  return (
    <div>
      <PageHeader
        kicker="ACCESS · 数据授权"
        desc="产品级授权只回答「这家机构能不能碰这份数据产品」；以什么条款执行由数字合约决定（两层都过才放行）。回收必须写原因，记录保留。"
        action={
          canAdminister ? (
            <button className="cs-btn" onClick={() => setShowGrant((v) => !v)}>
              <Plus size={15} /> {showGrant ? "收起" : "授予访问"}
            </button>
          ) : null
        }
      />

      {canAdminister && showGrant && (
        <div className="px-8 pt-6">
          <GrantForm
            products={manageableProducts}
            institutions={institutionRows}
            providerId={user?.role === "provider" ? user?.participantId : undefined}
            onDone={(m) => {
              setMsg(m);
              setShowGrant(false);
              void queryClient.invalidateQueries({ queryKey: ["access-grants"] });
            }}
          />
        </div>
      )}

      {showRequestSection && (
        <div className="px-8 pt-6">
          <div className="cs-label mb-2">
            {canAdminister ? `待处理的访问申请（${pendingRequests.length}）` : "我的访问申请"}
          </div>
          {requestRows.length === 0 ? (
            <Panel className="px-5 py-4 text-sm" style={{ color: "var(--cs-faint)" }}>
              还没有访问申请。{canAdminister ? "使用方在数据产品页发起后，会出现在这里。" : ""}
            </Panel>
          ) : (
            <div className="space-y-2">
              {(canAdminister ? pendingRequests : requestRows).map((row) => {
                const chip = requestStatusLabel(row);
                const applicant = row.requester?.name || row.requester?.email || row.requesterParticipantId;
                return (
                  <Panel key={row.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="flex-1 min-w-[240px] space-y-1">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="text-sm font-medium">
                            {institutionName(orgBySlug, row.requesterParticipantId)}
                          </span>
                          <span className="text-xs" style={{ color: "var(--cs-dim)" }}>{applicant}</span>
                          <span className="text-xs" style={{ color: "var(--cs-faint)" }}>
                            · {permissionSummary(row.permissions)}
                          </span>
                        </div>
                        <div className="text-sm">
                          {productTitle.get(row.dataProductId) ?? row.dataProductId}
                        </div>
                        <div className="text-xs" style={{ color: "var(--cs-faint)" }}>
                          申请：{formatDate(row.createdAt) ?? "未记录"}
                          {row.decisionNote ? ` · 审批意见：${row.decisionNote}` : ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                        <span className="cs-chip" style={{ borderColor: chip.color, color: chip.color }}>
                          {chip.label}
                        </span>
                        {canAdminister && isPendingRequest(row) && (
                          <>
                            <button className="cs-btn text-xs" onClick={() => void approveRequest(row)}>
                              批准并授予
                            </button>
                            <button
                              className="cs-btn text-xs"
                              style={{ borderColor: "var(--cs-red)", color: "var(--cs-red)" }}
                              onClick={() => void rejectRequest(row)}
                            >
                              拒绝
                            </button>
                          </>
                        )}
                        {!canAdminister && isPendingRequest(row) && (
                          <button className="cs-btn text-xs" onClick={() => void withdrawRequest(row)}>
                            撤回
                          </button>
                        )}
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="px-8 pt-6 flex flex-wrap items-center gap-2">
        <select
          className="cs-input text-sm"
          style={{ width: 260 }}
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          title="按数据产品筛选"
        >
          <option value="">全部数据产品</option>
          {productOptions.map((p) => (
            <option key={String(p.id)} value={String(p.id)}>
              {String(p.title ?? p.id)}
            </option>
          ))}
        </select>
        <span className="flex flex-wrap items-center gap-2 ml-2">
          {FACETS.map((id) => {
            const meta = {
              active: { label: "生效中", color: "var(--cs-green)" },
              expired: { label: "已过期", color: "var(--cs-amber)" },
              revoked: { label: "已回收", color: "var(--cs-dim)" },
            }[id];
            const selected = facet === id;
            return (
              <button
                key={id}
                type="button"
                className="cs-btn cs-btn-ghost text-sm"
                style={selected ? { borderColor: meta.color, color: meta.color } : undefined}
                aria-pressed={selected}
                onClick={() => setFacetOverride(id)}
              >
                {meta.label}
                <span className="cs-mono ml-1.5" style={{ color: selected ? meta.color : "var(--cs-faint)" }}>
                  {counts[id]}
                </span>
              </button>
            );
          })}
        </span>
        {msg && (
          <span className="ml-auto text-xs" style={{ color: "var(--cs-dim)" }}>
            {msg}
          </span>
        )}
      </div>

      <div className="p-8 space-y-3">
        <AsyncBoundary
          loading={grants.isLoading}
          error={grants.error}
          empty={rows.length === 0}
          loadingText="装载授权…"
          errorText="无法连接 /data-access/grants。"
          emptyText={canAdminister ? "还没有授权记录。点右上「授予访问」给某家机构开放产品。" : "还没有机构被授权访问这些数据产品。"}
        >
          {visible.length === 0 ? (
            <Panel className="px-6 py-10 text-center text-sm" style={{ color: "var(--cs-faint)" }}>
              这个状态下没有授权。
            </Panel>
          ) : (
            visible.map((row) => {
              const chip = grantStateLabel(row);
              const org = institutionName(orgBySlug, row.granteeParticipantId);
              const state = grantState(row);
              return (
                <Panel key={row.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1 min-w-[260px] space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-sm font-medium">{org}</span>
                        <span className="cs-mono text-[0.7rem]" style={{ color: "var(--cs-faint)" }}>
                          {row.granteeParticipantId}
                        </span>
                        <span className="text-xs" style={{ color: "var(--cs-dim)" }}>
                          · {permissionSummary(row.permissions)}
                        </span>
                      </div>
                      <div className="text-sm" style={{ color: "var(--cs-text)" }}>
                        {productTitle.get(row.dataProductId) ?? row.dataProductId}
                      </div>
                      <div className="text-xs" style={{ color: "var(--cs-faint)" }}>
                        授予：{formatDate(row.grantedAt) ?? "未记录"}
                        {row.expiresAt ? ` · 到期：${formatDate(row.expiresAt)}` : " · 长期有效"}
                        {row.note ? ` · 备注：${row.note}` : ""}
                        {state === "revoked" && row.revokeReason
                          ? ` · 回收原因：${row.revokeReason}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                      <span className="cs-chip" style={{ borderColor: chip.color, color: chip.color }}>
                        {chip.label}
                      </span>
                      {canAdminister && state === "active" && (
                        <button
                          className="cs-btn text-xs"
                          style={{ borderColor: "var(--cs-red)", color: "var(--cs-red)" }}
                          onClick={() => void revoke(row)}
                        >
                          回收
                        </button>
                      )}
                    </div>
                  </div>
                </Panel>
              );
            })
          )}
        </AsyncBoundary>
        {!canAdminister && (
          <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--cs-faint)" }}>
            <ShieldCheck size={13} /> 你看到的是「谁被授权访问」，授予与回收由数据提供方或合规/运营方操作。
          </p>
        )}
      </div>
    </div>
  );
}

function GrantForm({
  products,
  institutions,
  providerId,
  onDone,
}: {
  products: Array<{ id: string; title?: string; providerId?: string }>;
  institutions: Array<{ id: string; participantId?: string | null; org: string }>;
  providerId?: string;
  onDone: (message: string) => void;
}) {
  const [dataProductId, setProductId] = useState(products[0]?.id ? String(products[0].id) : "");
  const [grantee, setGrantee] = useState("");
  const [permissions, setPermissions] = useState<AccessPermission[]>(["compute"]);
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");

  const selectedProduct = products.find((p) => String(p.id) === dataProductId);
  const options = granteeOptions(
    institutions,
    providerId ?? (selectedProduct?.providerId as string | undefined),
  );

  const toggle = (p: AccessPermission) => {
    setPermissions((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  };

  const submit = async () => {
    setError("");
    if (!dataProductId) return setError("请选择数据产品");
    if (!grantee) return setError("请选择被授权机构");
    if (!permissions.length) return setError("至少选择一个权限位");
    try {
      await api.grantAccess({
        dataProductId,
        granteeParticipantId: grantee,
        permissions,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(expiresAt ? { expiresAt: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}),
      });
      onDone("已授予");
    } catch (e: any) {
      setError(e?.message || "授予失败");
    }
  };

  return (
    <Panel className="p-5">
      <div className="cs-label mb-3">授予访问（产品级 ACL）</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="cs-label block">数据产品</span>
          <select
            className="cs-input text-sm"
            style={{ width: 260 }}
            value={dataProductId}
            onChange={(e) => {
              setProductId(e.target.value);
              setGrantee("");
            }}
          >
            <option value="">选择产品…</option>
            {products.map((p) => (
              <option key={String(p.id)} value={String(p.id)}>
                {String(p.title ?? p.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="cs-label block">被授权机构</span>
          <select
            className="cs-input text-sm"
            style={{ width: 240 }}
            value={grantee}
            onChange={(e) => setGrantee(e.target.value)}
          >
            <option value="">选择机构…</option>
            {options.map((o) => (
              <option key={o.participantId} value={o.participantId}>
                {o.org}
              </option>
            ))}
          </select>
        </label>
        <div className="space-y-1">
          <span className="cs-label block">权限位</span>
          <div className="flex items-center gap-3 h-9">
            {(["catalog", "compute"] as AccessPermission[]).map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm" style={{ color: "var(--cs-dim)" }}>
                <input
                  type="checkbox"
                  checked={permissions.includes(p)}
                  onChange={() => toggle(p)}
                />
                {p === "catalog" ? "查看目录" : "可计算"}
              </label>
            ))}
          </div>
        </div>
        <label className="space-y-1">
          <span className="cs-label block">到期日（可选）</span>
          <input
            type="date"
            className="cs-input text-sm"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
        <label className="space-y-1 flex-1 min-w-[180px]">
          <span className="cs-label block">备注（可选）</span>
          <input
            className="cs-input text-sm w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：联合课题阶段性开放"
          />
        </label>
        <button className="cs-btn" onClick={() => void submit()}>
          授予
        </button>
      </div>
      {error && (
        <p className="text-sm mt-3" style={{ color: "var(--cs-red)" }}>
          {error}
        </p>
      )}
    </Panel>
  );
}
