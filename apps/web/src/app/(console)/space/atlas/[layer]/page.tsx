"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { api } from "@/api/client";
import { useAuth } from "@/lib/auth";
import {
  LAYER_META,
  LAYER_ORDER,
  type CapabilityLayer,
  type CapabilityObject,
} from "@/types/capability.types";
import { ObjectEditor } from "@/components/atlas/object-editor";
import { isLanded, landingTitle } from "@/lib/capability-landing";

function summary(layer: CapabilityLayer, o: CapabilityObject): { tag?: string; refs: string[] } {
  switch (layer) {
    case "l1_scenario": return { tag: o.riskLevel, refs: [...(o.typicalModelKeys ?? []), ...(o.typicalAlgorithmKeys ?? [])] };
    case "l3_model": return { tag: o.category, refs: o.trainingAlgorithmKeys ?? [] };
    case "l4_algorithm": return { tag: o.category, refs: o.underlyingOperatorKeys ?? [] };
    case "l5_operator": return { tag: o.opType, refs: o.supportedProtocolKeys ?? [] };
    case "l6_protocol": return { tag: o.securityCapabilityLevel, refs: o.handlerKey ? [o.handlerKey] : [] };
    case "l7_infrastructure": return { tag: o.vendor, refs: o.handlerKey ? [o.handlerKey] : [] };
    default: return { refs: [] };
  }
}

export default function LayerRegistryPage() {
  const params = useParams();
  const layer = params.layer as CapabilityLayer;
  const valid = (LAYER_ORDER as string[]).includes(layer);
  const qc = useQueryClient();
  const { user } = useAuth();
  const isOperator = user?.role === "operator";
  const [editing, setEditing] = useState<CapabilityObject | null | undefined>(undefined);

  const { data, isLoading, error } = useQuery({
    queryKey: ["atlas", layer],
    queryFn: () => api.listCapability(layer),
    enabled: valid,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["atlas", layer] });
    qc.invalidateQueries({ queryKey: ["atlas", "all"] });
  };

  const save = useMutation({
    mutationFn: ({ dto, isEdit }: { dto: Partial<CapabilityObject>; isEdit: boolean }) =>
      isEdit
        ? api.updateCapabilityObject(layer, (editing as CapabilityObject).key, dto)
        : api.createCapabilityObject(layer, dto),
    onSuccess: () => { invalidate(); setEditing(undefined); },
  });
  const del = useMutation({
    mutationFn: (key: string) => api.deleteCapabilityObject(layer, key),
    onSuccess: invalidate,
  });

  if (!valid) {
    return (
      <Card className="p-6" style={{ background: "var(--at-paper-2)" }}>
        <div className="at-label">未知层</div>
        <p className="mt-2 text-sm" style={{ color: "var(--at-ink-2)" }}>
          {layer} 不是可浏览的能力层。L2 合规为规则层(只读),见 <Link href="/space/atlas/compose" className="at-key">合规预审</Link>。
        </p>
        <Button asChild variant="outline" className="mt-4"><Link href="/space/atlas"><ArrowLeft size={15} /> 返回总览</Link></Button>
      </Card>
    );
  }

  const m = LAYER_META[layer];

  return (
    <div>
      <Button asChild variant="link" className="px-0" style={{ color: "var(--at-ink-2)" }}>
        <Link href="/space/atlas"><ArrowLeft size={15} /> 总览</Link>
      </Button>

      <div className="flex items-end justify-between gap-6 mt-2">
        <div>
          <div className="at-label">{m.n} · {m.en}</div>
          <h1 className="at-display text-4xl font-semibold mt-1.5">{m.label}注册表</h1>
          <p className="text-sm mt-1.5" style={{ color: "var(--at-faint)" }}>
            {m.role}{data ? ` · 已落地 ${data.filter(isLanded).length}/${data.length}` : ""}
          </p>
        </div>
        {isOperator ? (
          <Button onClick={() => setEditing(null)}><Plus size={16} /> 新建对象</Button>
        ) : (
          <Badge variant="outline">仅运营方(operator)可编辑</Badge>
        )}
      </div>

      {del.error && <Card className="p-3 mt-4 text-sm" style={{ color: "var(--at-block)", background: "var(--at-paper-2)" }}>删除失败:{(del.error as Error).message}</Card>}

      <Card className="mt-6 overflow-hidden p-0" style={{ background: "var(--at-paper-2)" }}>
        <div className="grid px-5 py-2.5 at-label" style={{ gridTemplateColumns: "180px 1fr 110px 90px", borderBottom: "1px solid var(--at-line)" }}>
          <div>KEY</div><div>名称 · 依赖</div><div>标签</div><div className="text-right">操作</div>
        </div>
        {isLoading && <div className="px-5 py-6 text-sm" style={{ color: "var(--at-faint)" }}>装载…</div>}
        {error && <div className="px-5 py-6 text-sm" style={{ color: "var(--at-block)" }}>无法连接 API。</div>}
        {data?.map((o, i) => {
          const s = summary(layer, o);
          return (
            <div
              key={o.key}
              className="grid items-center px-5 py-3.5 at-reveal transition-colors hover:bg-[var(--at-paper)]"
              style={{ gridTemplateColumns: "180px 1fr 110px 90px", borderBottom: "1px solid var(--at-line-soft)", animationDelay: `${Math.min(i, 12) * 30}ms` }}
            >
              <div className="flex items-center gap-2 min-w-0" title={landingTitle(o)}>
                <span className="at-land-dot" data-landed={isLanded(o)} />
                <span className="at-key">{o.key}</span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{o.name}</div>
                {s.refs.length > 0 && (
                  <div className="at-mono text-[0.66rem] mt-1 truncate" style={{ color: "var(--at-faint)" }}>
                    {s.refs.slice(0, 6).join(" · ")}{s.refs.length > 6 ? ` +${s.refs.length - 6}` : ""}
                  </div>
                )}
              </div>
              <div>{s.tag && <Badge variant="outline">{s.tag}</Badge>}</div>
              <div className="flex justify-end gap-1">
                {isOperator ? (
                  <>
                    <Button size="icon" variant="ghost" onClick={() => setEditing(o)} aria-label="编辑"><Pencil size={14} /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm(`删除 ${o.key}?`)) del.mutate(o.key); }} aria-label="删除">
                      <Trash2 size={14} style={{ color: "var(--at-block)" }} />
                    </Button>
                  </>
                ) : (
                  <span className="at-mono text-[0.66rem]" style={{ color: "var(--at-faint)" }}>只读</span>
                )}
              </div>
            </div>
          );
        })}
        {data && data.length === 0 && <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--at-faint)" }}>该层暂无对象。</div>}
      </Card>

      {editing !== undefined && (
        <ObjectEditor
          layer={layer}
          initial={editing}
          saving={save.isPending}
          onClose={() => setEditing(undefined)}
          onSave={(dto, isEdit) => save.mutate({ dto, isEdit })}
        />
      )}
      {save.error && <Card className="p-3 mt-4 text-sm" style={{ color: "var(--at-block)", background: "var(--at-paper-2)" }}>保存失败:{(save.error as Error).message}</Card>}
    </div>
  );
}
