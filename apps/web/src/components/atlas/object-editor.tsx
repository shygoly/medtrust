"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { codexFontVars } from "@/app/(console)/space/atlas/fonts";
import type { CapabilityLayer, CapabilityObject } from "@/types/capability.types";
import { LAYER_META } from "@/types/capability.types";

type Field = {
  k: keyof CapabilityObject;
  label: string;
  kind: "text" | "textarea" | "array" | "bool" | "risk" | "seclevel";
  required?: boolean;
};

const COMMON: Field[] = [{ k: "name", label: "名称 name", kind: "text", required: true }];

const SCHEMA: Record<CapabilityLayer, Field[]> = {
  l1_scenario: [
    { k: "riskLevel", label: "风险等级", kind: "risk", required: true },
    { k: "description", label: "描述", kind: "textarea" },
    { k: "criteria", label: "判定标准 criteria", kind: "text" },
    { k: "typicalModelKeys", label: "推荐模型 keys", kind: "array" },
    { k: "typicalAlgorithmKeys", label: "推荐算法 keys", kind: "array" },
  ],
  l3_model: [
    { k: "category", label: "类别 category", kind: "text", required: true },
    { k: "trainingAlgorithmKeys", label: "训练算法 keys", kind: "array" },
    { k: "complianceNote", label: "合规备注", kind: "textarea" },
  ],
  l4_algorithm: [
    { k: "category", label: "类别 category", kind: "text", required: true },
    { k: "underlyingOperatorKeys", label: "底层算子 keys", kind: "array" },
    { k: "compliancePrivacyModels", label: "隐私模型说明", kind: "array" },
  ],
  l5_operator: [
    { k: "opType", label: "算子类型 opType", kind: "text", required: true },
    { k: "supportedProtocolKeys", label: "支持协议 keys", kind: "array" },
    { k: "complianceDriven", label: "合规驱动", kind: "bool" },
    { k: "triggeredBy", label: "触发条件 triggeredBy", kind: "text" },
  ],
  l6_protocol: [
    { k: "family", label: "族 family", kind: "text", required: true },
    { k: "securityAssumption", label: "安全假设", kind: "textarea", required: true },
    { k: "securityCapabilityLevel", label: "保障级", kind: "seclevel", required: true },
    { k: "handlerKey", label: "实现 handlerKey", kind: "text" },
  ],
  l7_infrastructure: [
    { k: "infraType", label: "类型 infraType", kind: "text", required: true },
    { k: "vendor", label: "厂商 vendor", kind: "text", required: true },
    { k: "complianceNote", label: "合规备注", kind: "textarea" },
    { k: "handlerKey", label: "实现 handlerKey", kind: "text" },
  ],
};

export function ObjectEditor({
  layer,
  initial,
  onClose,
  onSave,
  saving,
}: {
  layer: CapabilityLayer;
  initial?: CapabilityObject | null;
  onClose: () => void;
  onSave: (dto: Partial<CapabilityObject>, isEdit: boolean) => void;
  saving?: boolean;
}) {
  const isEdit = !!initial;
  const fields = [...COMMON, ...SCHEMA[layer]];
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...(initial ?? {}) }));
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    const dto: Record<string, unknown> = { ...form };
    if (!isEdit) dto.key = (form.key as string)?.trim();
    for (const f of fields) {
      if (f.kind === "array" && typeof dto[f.k] === "string") {
        dto[f.k] = (dto[f.k] as string).split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      }
    }
    onSave(dto as Partial<CapabilityObject>, isEdit);
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={cn(codexFontVars, "codex max-w-xl max-h-[88vh] overflow-auto")}>
        <DialogHeader>
          <div className="at-label">{LAYER_META[layer].n} · {LAYER_META[layer].en}</div>
          <DialogTitle className="at-display text-2xl font-semibold">
            {isEdit ? `编辑 ${initial!.key}` : `新建${LAYER_META[layer].label}对象`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label className="at-label">标识 key <span style={{ color: "var(--at-seal)" }}>*</span></Label>
              <Input className="at-mono" placeholder="e.g. my-model" value={(form.key as string) ?? ""} onChange={(e) => set("key", e.target.value)} />
              <p className="text-xs" style={{ color: "var(--at-faint)" }}>稳定 slug,跨层引用依赖它,创建后不可改</p>
            </div>
          )}

          {fields.map((f) => (
            <div key={String(f.k)} className="space-y-1.5">
              <Label className="at-label">
                {f.label}{f.required && <span style={{ color: "var(--at-seal)" }}> *</span>}
              </Label>
              {f.kind === "textarea" ? (
                <Textarea rows={2} value={(form[f.k] as string) ?? ""} onChange={(e) => set(f.k, e.target.value)} />
              ) : f.kind === "array" ? (
                <Input
                  className="at-mono"
                  placeholder="逗号或空格分隔的 key"
                  value={Array.isArray(form[f.k]) ? (form[f.k] as string[]).join(", ") : ((form[f.k] as string) ?? "")}
                  onChange={(e) => set(f.k, e.target.value)}
                />
              ) : f.kind === "bool" ? (
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--at-ink-2)" }}>
                  <input type="checkbox" checked={!!form[f.k]} onChange={(e) => set(f.k, e.target.checked)} />
                  {form[f.k] ? "是" : "否"}
                </label>
              ) : f.kind === "risk" ? (
                <Select value={(form[f.k] as string) || undefined} onValueChange={(v) => set(f.k, v)}>
                  <SelectTrigger><SelectValue placeholder="选择风险等级" /></SelectTrigger>
                  <SelectContent className={cn(codexFontVars, "codex")}>
                    <SelectItem value="low">low</SelectItem>
                    <SelectItem value="medium">medium</SelectItem>
                    <SelectItem value="high">high</SelectItem>
                  </SelectContent>
                </Select>
              ) : f.kind === "seclevel" ? (
                <Select value={(form[f.k] as string) || undefined} onValueChange={(v) => set(f.k, v)}>
                  <SelectTrigger><SelectValue placeholder="选择保障级" /></SelectTrigger>
                  <SelectContent className={cn(codexFontVars, "codex")}>
                    <SelectItem value="basic">basic</SelectItem>
                    <SelectItem value="enhanced">enhanced</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input value={(form[f.k] as string) ?? ""} onChange={(e) => set(f.k, e.target.value)} />
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "保存中…" : isEdit ? "保存修改" : "创建对象"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
