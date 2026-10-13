/**
 * 编排通道解析单点（D-MDOP-7，openspec 能力 orchestration-kernel）。
 *
 * 台账 orchestration.migration.json 是「哪个分析/作业类型由哪条通道执行」的唯一事实源，本模块是它
 * 唯一的读取与判定入口：控制器与服务 MUST NOT 自己按分析类型判断通道。
 *
 * 三条纪律：
 *  1. resolveChannel(key)：未知 key 一律抛错（fail-closed），不猜、不回退默认通道；
 *  2. channelForAnalysisType(type)：把 RWS analysisType 映射到台账 key，未知同样抛错；
 *  3. 单通道到点生效：条目 cutoverAt 到点后，非授权通道的提交一律拒绝（E_CHANNEL_LEGACY /
 *     E_CHANNEL_MDOP）；未到点不拦（迁移期两条通道都还要能跑）。回滚演练用
 *     ORCHESTRATION_FORCE_CHANNEL（仅非生产）覆盖，台账不因此改变——legacy 仍只减不增。
 */
import ledger from "./orchestration.migration.json";

export type OrchestrationChannel = "mdop" | "legacy";
export type OrchestrationState =
  "pending" | "in-migration" | "migrated" | "verification" | "legacy-removed";
export type OrchestrationKind = "rws-analysis" | "fl-workload" | "mdop-native";

export interface ChannelEntry {
  key: string;
  kind: OrchestrationKind;
  label: string;
  channel: OrchestrationChannel;
  state: OrchestrationState;
  mdopTemplate: string | null;
  legacyStorage?: "tables" | "in-memory";
  legacyTables: string[];
  legacyRefs: Array<string | { path: string; mustNotContain?: string }>;
  equivalenceEvidence: string | null;
  verification: { status: string; expires: string; note?: string } | null;
  sunset: string | null;
  cutoverAt?: string | null;
  blockedBy?: string;
  note?: string;
}

export interface OrchestrationLedger {
  schemaVersion: number;
  updated: string;
  legacyBudget: number;
  channels: ChannelEntry[];
}

export const ORCHESTRATION_LEDGER = ledger as OrchestrationLedger;
export const ORCHESTRATION_ENTRIES: readonly ChannelEntry[] =
  ORCHESTRATION_LEDGER.channels;

export type OrchestrationErrorCode =
  "E_CHANNEL_UNKNOWN" | "E_CHANNEL_LEGACY" | "E_CHANNEL_MDOP";

export class OrchestrationChannelError extends Error {
  constructor(
    readonly code: OrchestrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrchestrationChannelError";
  }
}

const BY_KEY = new Map(ORCHESTRATION_ENTRIES.map((e) => [e.key, e]));

export function entryOf(key: string): ChannelEntry {
  const e = BY_KEY.get(key);
  if (!e) {
    throw new OrchestrationChannelError(
      "E_CHANNEL_UNKNOWN",
      "[E_CHANNEL_UNKNOWN] 未登记的分析/作业类型：" +
        key +
        "（迁移台账里没有这个 key，按 fail-closed 拒绝）",
    );
  }
  return e;
}

/** 演练覆盖：仅非生产、必须显式点名 key=channel，台账不因此改变。 */
function forcedChannel(key: string): OrchestrationChannel | null {
  if (process.env.NODE_ENV === "production") return null;
  const spec = (process.env.ORCHESTRATION_FORCE_CHANNEL ?? "").trim();
  if (!spec) return null;
  for (const part of spec.split(",")) {
    const kv = part.split("=");
    const k = (kv[0] ?? "").trim();
    const v = (kv[1] ?? "").trim();
    if (k === key && (v === "mdop" || v === "legacy")) return v;
  }
  return null;
}

export function resolveChannel(key: string): OrchestrationChannel {
  return forcedChannel(key) ?? entryOf(key).channel;
}

export function channelForAnalysisType(
  analysisType: string,
): OrchestrationChannel {
  return resolveChannel("rws." + analysisType);
}

/** 切换日是否已到（纯函数，便于单测与运维查询）。 */
export function isCutoverPassed(
  e: { cutoverAt?: string | null },
  now = Date.now(),
): boolean {
  if (!e.cutoverAt) return false;
  const t = Date.parse(e.cutoverAt);
  return Number.isFinite(t) && t <= now;
}

/**
 * 纯判定：授权通道与请求入口不一致时，未到切换日放行（迁移期两条通道都还要能跑），到点抛错。
 * 这是「一个类型只有一条通道」在服务端的执行点；调用方拿到 enforced=true 时应记日志。
 */
export function decideEntry(
  e: ChannelEntry,
  authorized: OrchestrationChannel,
  attempted: OrchestrationChannel,
  now = Date.now(),
): { enforced: boolean; channel: OrchestrationChannel } {
  if (authorized === attempted) return { enforced: true, channel: authorized };
  if (!isCutoverPassed(e, now)) return { enforced: false, channel: authorized };
  throw attempted === "legacy"
    ? new OrchestrationChannelError(
        "E_CHANNEL_MDOP",
        "[E_CHANNEL_MDOP] 该类型已切到 MDOP 通道（" +
          e.key +
          "），旧入口不再受理（state=" +
          e.state +
          "）",
      )
    : new OrchestrationChannelError(
        "E_CHANNEL_LEGACY",
        "[E_CHANNEL_LEGACY] 该类型仍在旧通道（" +
          e.key +
          "），MUST NOT 从 MDOP 入口提交",
      );
}

/** 提交入口判定（台账 + 非生产演练覆盖）。 */
export function assertEntryAllowed(
  key: string,
  attempted: OrchestrationChannel,
): { enforced: boolean; channel: OrchestrationChannel } {
  return decideEntry(entryOf(key), resolveChannel(key), attempted);
}

/** 规矩 1（不双写）：走 MDOP 的类型 MUST NOT 再落旧表。 */
export function assertNoLegacyWrite(key: string, table: string): void {
  const e = entryOf(key);
  if (resolveChannel(key) === "mdop" && e.legacyTables.includes(table)) {
    throw new Error(
      "[orchestration] 不双写违规：" + key + " 已走 MDOP，却仍写旧表 " + table,
    );
  }
}

/** 观察用：当前台账里 legacy 条目的 key（供日志与运维查询）。 */
export function legacyKeys(): string[] {
  return ORCHESTRATION_ENTRIES.filter((e) => e.channel === "legacy").map(
    (e) => e.key,
  );
}
