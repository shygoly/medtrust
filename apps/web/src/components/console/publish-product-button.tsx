"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api/client";
import { getUser } from "@/lib/auth";

const DEFAULT_DATA_PATH =
  process.env.NEXT_PUBLIC_CONNECTOR_DATA_PATH || "/data/synthea/ingested";
const DEFAULT_RECORD_COUNT = 256;

// Provider-only action: publishes a data product via the real, role-guarded
// POST /catalog (server enforces provider role + confirm/classify gate).
export function PublishProductButton({
  defaultType = "data",
}: { defaultType?: "data" | "service" } = {}) {
  const [open, setOpen] = useState(false);
  const [productType, setProductType] = useState<"data" | "service">(defaultType);
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState("敏感");
  const [dataPath, setDataPath] = useState(DEFAULT_DATA_PATH);
  const [recordCount, setRecordCount] = useState(DEFAULT_RECORD_COUNT);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setMsg("提交中…");
    try {
      const user = getUser();
      const classificationTag = {
        一般: { level: "1", categoryCode: "GENERAL", version: "NDI-TR-2025-06" },
        重要: { level: "2", categoryCode: "IMPORTANT", version: "NDI-TR-2025-06" },
        敏感: { level: "3", categoryCode: "SENSITIVE", version: "NDI-TR-2025-06" },
      }[classification] ?? {
        level: "1",
        categoryCode: "GENERAL",
        version: "NDI-TR-2025-06",
      };
      const r: any = await api.createDataAsset({
        providerId: user?.participantId,
        title,
        productType,
        classification,
        classificationTag,
        rightsConfirmed: true,
        recordCount,
        dataPath,
        fhirSchema: {
          source: "Synthea",
          format: "FHIR Bundle",
          dataPath,
        },
      } as any);
      setMsg(`已发布 ✓ ${String(r.id).slice(0, 8)}`);
      setTitle("");
    } catch (e: any) {
      setMsg("失败: " + (e?.message || "请求错误"));
    }
  };

  if (!open) {
    return (
      <button className="cs-btn" onClick={() => setOpen(true)}>
        <Plus size={15} /> 发布数据产品
      </button>
    );
  }
  return (
    <div className="cs-panel p-4 space-y-3" style={{ minWidth: 420 }}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="cs-input"
          style={{ width: 200 }}
          placeholder="数据产品标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select
          className="cs-input"
          style={{ width: 110 }}
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
        >
          <option>敏感</option>
          <option>重要</option>
          <option>一般</option>
        </select>
        <select
          className="cs-input"
          style={{ width: 110 }}
          value={productType}
          onChange={(e) => setProductType(e.target.value as "data" | "service")}
        >
          <option value="data">数据产品</option>
          <option value="service">数据服务</option>
        </select>
      </div>
      <div>
        <label className="cs-label block mb-1">连接器本地数据路径</label>
        <input
          className="cs-input w-full cs-mono text-xs"
          placeholder="如 /data/synthea/ingested"
          value={dataPath}
          onChange={(e) => setDataPath(e.target.value)}
        />
        <p className="text-[0.68rem] mt-1" style={{ color: "var(--cs-faint)" }}>
          Fly: 华山 connector-a / 瑞金 connector-b 各持 /data/synthea/ingested 一半患者;本地 dev 用 data/synthea/ingested。
        </p>
      </div>
      <div className="flex items-center gap-2">
        <label className="cs-label shrink-0">记录规模</label>
        <input
          type="number"
          min={0}
          className="cs-input cs-mono"
          style={{ width: 100 }}
          value={recordCount}
          onChange={(e) => setRecordCount(parseInt(e.target.value, 10) || 0)}
        />
        <span className="text-[0.68rem]" style={{ color: "var(--cs-faint)" }}>行 / 患者数</span>
        <button className="cs-btn ml-auto" disabled={!title || !dataPath} onClick={submit}>
          确权并发布
        </button>
      </div>
      {msg && <span className="cs-label">{msg}</span>}
    </div>
  );
}
