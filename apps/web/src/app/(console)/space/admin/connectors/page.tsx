"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Banner, PageHeader } from "@/components/console/ui";

type Enrollment = {
  id: string;
  connectorId: string;
  participantId: string;
  subjectPublicKey: string;
  status: "pending" | "approved" | "rejected";
  fingerprint?: string | null;
  rejectReason?: string | null;
  createdAt: string;
};

type Registered = {
  connectorId: string;
  participantId: string;
  sm2Fingerprint: string;
  revoked: boolean;
};

const STATUS_LABEL: Record<Enrollment["status"], string> = {
  pending: "待批准",
  approved: "已签发",
  rejected: "已驳回",
};

export default function AdminConnectorsPage() {
  const [items, setItems] = useState<Enrollment[]>([]);
  const [registered, setRegistered] = useState<Registered[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setError("");
    const [enrollments, certs] = await Promise.all([
      api.listConnectorEnrollments(),
      api.listRegisteredConnectors(),
    ]);
    setItems(enrollments);
    setRegistered(certs);
  };

  useEffect(() => {
    load().catch((err: Error) => setError(err.message || "加载失败"));
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(ok);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  };

  return (
    <div>
      <PageHeader
        kicker="OPERATOR · 连接器入网"
        desc="批准或驳回医院连接器提交的入网申请，并吊销已签发的证书。私钥留在医院机器上，这里只处理公钥和证书。"
      />
      <div className="p-8 space-y-4">
        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="success">{notice}</Banner>}

        <section className="cs-panel p-5 space-y-3">
          <div className="cs-label">待处理申请</div>
          {items.length === 0 ? (
            <div className="text-sm" style={{ color: "var(--cs-dim)" }}>暂无入网申请</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 border-b py-3" style={{ borderColor: "var(--cs-line)" }}>
                <div>
                  <div className="font-medium">{item.participantId} · {item.connectorId}</div>
                  <div className="cs-mono text-xs mt-1" style={{ color: "var(--cs-faint)" }}>{item.subjectPublicKey}</div>
                  <div className="text-sm mt-1" style={{ color: "var(--cs-dim)" }}>
                    {STATUS_LABEL[item.status]}
                    {item.fingerprint ? ` · ${item.fingerprint}` : ""}
                    {item.rejectReason ? ` · ${item.rejectReason}` : ""}
                  </div>
                </div>
                {item.status === "pending" && (
                  <div className="flex gap-2">
                    <button className="cs-btn" onClick={() => run(() => api.approveConnectorEnrollment(item.id), "已签发证书")}>批准</button>
                    <button
                      className="cs-btn cs-btn-ghost"
                      onClick={() => {
                        const reason = window.prompt("驳回原因") || "";
                        if (!reason.trim()) return;
                        void run(() => api.rejectConnectorEnrollment(item.id, reason), "已驳回");
                      }}
                    >
                      驳回
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </section>

        <section className="cs-panel p-5 space-y-3">
          <div className="cs-label">已签发证书</div>
          {registered.filter((row) => !row.revoked).length === 0 ? (
            <div className="text-sm" style={{ color: "var(--cs-dim)" }}>暂无有效证书</div>
          ) : (
            registered.filter((row) => !row.revoked).map((row) => (
              <div key={row.sm2Fingerprint} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <div className="font-medium">{row.participantId} · {row.connectorId}</div>
                  <div className="cs-mono text-xs" style={{ color: "var(--cs-faint)" }}>{row.sm2Fingerprint}</div>
                </div>
                <button
                  className="cs-btn cs-btn-ghost"
                  onClick={() => {
                    if (!window.confirm(`吊销 ${row.connectorId} 的证书？`)) return;
                    void run(() => api.deregisterConnector(row.connectorId), "已吊销");
                  }}
                >
                  吊销
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
