/**
 * L4-audit — RED 阶段（TDD Test 阶段）审计轨迹与证据档案验收测试。
 *
 * Acceptance（任务卡 L4-audit）:
 *   A. 证据档案包含全部层级（L1.5 / L2 / L3 / L4）运行元数据；
 *   B. 该档案可由 audit-checklist 文件逐项核对，且全部勾选。
 * Gap:
 *   缺少贯穿 L1.5-L4 的审计轨迹与证据档案，监管或发表场景无法追溯各层级产出。
 *
 * 目标缺陷（均为断言级失败 is_assertion_failure=true）:
 *   1. data/audit/evidence-archive.json 不存在 —— 验收 A 的载体缺失。
 *   2. 档案不覆盖全部层级（L1.5/L2/L3/L4 缺任一）—— 验收 A 不成立。
 *   3. 各层级条目缺必需运行元数据字段（run_id/level/started_at/ended_at/outcome/artifacts）。
 *   4. data/audit/audit-checklist.md 不存在 —— 验收 B 的核对工具缺失。
 *   5. 清单存在但未全部勾选 / 未覆盖 L1.5-L4 —— 验收 B 不成立。
 *   6. 清单勾选项无法逐项对应到证据档案条目 —— 「逐项核对」不可执行。
 */
import * as fs from "fs";
import * as path from "path";

// 本文件位于 apps/api/src/runtime/rws-analytics-ladder/ → 仓库根 = ../../../../../
const ROOT = path.resolve(__dirname, "../../../../../");

const ARCHIVE_PATH = path.join(ROOT, "data/audit/evidence-archive.json");
const CHECKLIST_PATH = path.join(ROOT, "data/audit/audit-checklist.md");

/** 必须被档案覆盖的分析层级（贯穿 L1.5-L4）。 */
const LEVELS = ["L1.5", "L2", "L3", "L4"] as const;

/** 每个层级条目必须具备的运行元数据字段。 */
const REQUIRED_METADATA_FIELDS = [
  "run_id",
  "level",
  "started_at",
  "ended_at",
  "outcome",
  "artifacts",
] as const;

interface LevelRunMetadata {
  level: string;
  run_id: string;
  started_at: string;
  ended_at: string;
  outcome: string;
  artifacts: string[];
}

interface EvidenceArchive {
  archiveVersion?: string;
  generatedAt?: string;
  levels?: Record<string, LevelRunMetadata>;
}

function readArchive(): EvidenceArchive {
  return JSON.parse(fs.readFileSync(ARCHIVE_PATH, "utf-8")) as EvidenceArchive;
}

/** 解析 checklist 中的勾选行，返回 [原始行, 是否已勾选] 列表。 */
function parseChecklistLines(
  text: string,
): Array<{ line: string; checked: boolean; text: string }> {
  const out: Array<{ line: string; checked: boolean; text: string }> = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) out.push({ line: raw, checked: m[1] !== " ", text: m[2] });
  }
  return out;
}

describe("L4-audit — 贯穿 L1.5-L4 的审计轨迹与证据档案", () => {
  it("L4-AUDIT-1a 证据档案文件存在：data/audit/evidence-archive.json", () => {
    // 验收 A 的载体：机器可读、可追溯、可由清单逐项核对。
    expect(fs.existsSync(ARCHIVE_PATH)).toBe(true);
  });

  it("L4-AUDIT-1b 证据档案覆盖全部层级运行元数据（L1.5/L2/L3/L4）", () => {
    expect(fs.existsSync(ARCHIVE_PATH)).toBe(true);
    if (!fs.existsSync(ARCHIVE_PATH)) return;

    const archive = readArchive();
    // 档案根必须带版本与生成时间，供监管/发表追溯。
    expect(typeof archive.archiveVersion).toBe("string");
    expect(typeof archive.generatedAt).toBe("string");
    expect(archive.levels).toBeDefined();
    if (!archive.levels) return;

    // 贯穿 L1.5-L4：四个层级缺一不可。
    for (const level of LEVELS) {
      expect(archive.levels).toHaveProperty(level);
    }
  });

  it("L4-AUDIT-1c 每个层级条目含完整运行元数据字段", () => {
    expect(fs.existsSync(ARCHIVE_PATH)).toBe(true);
    if (!fs.existsSync(ARCHIVE_PATH)) return;

    const archive = readArchive();
    expect(archive.levels).toBeDefined();
    if (!archive.levels) return;

    for (const level of LEVELS) {
      const entry = archive.levels[level];
      expect(entry).toBeDefined();
      if (!entry) continue;
      for (const field of REQUIRED_METADATA_FIELDS) {
        expect(entry).toHaveProperty(field);
      }
      // level 字段必须与档案键一致，避免张冠李戴。
      expect(entry.level).toBe(level);
      // outcome 必须有明确状态（ok / 失败或 reason），不能留白。
      expect(String(entry.outcome).length).toBeGreaterThan(0);
      // artifacts 声明该层级的产出物清单，至少一条。
      expect(Array.isArray(entry.artifacts)).toBe(true);
      if (Array.isArray(entry.artifacts)) {
        expect(entry.artifacts.length).toBeGreaterThan(0);
      }
    }
  });

  it("L4-AUDIT-2a audit-checklist 文件存在：data/audit/audit-checklist.md", () => {
    // 验收 B 的核对工具：逐项核对档案、全部勾选即验收通过。
    expect(fs.existsSync(CHECKLIST_PATH)).toBe(true);
  });

  it("L4-AUDIT-2b audit-checklist 覆盖 L1.5-L4 且全部勾选", () => {
    expect(fs.existsSync(CHECKLIST_PATH)).toBe(true);
    if (!fs.existsSync(CHECKLIST_PATH)) return;

    const items = parseChecklistLines(fs.readFileSync(CHECKLIST_PATH, "utf-8"));
    // 清单至少要有条目可核。
    expect(items.length).toBeGreaterThan(0);

    // 全部勾选：不允许存在未勾选项（- [ ]）。
    const unchecked = items.filter((i) => !i.checked);
    expect(unchecked).toEqual([]);

    // 覆盖 L1.5-L4：每个层级至少被一条已勾选项引用。
    for (const level of LEVELS) {
      expect(
        items.some(
          (i) => i.checked && new RegExp(`\\b${level}\\b`).test(i.line),
        ),
      ).toBe(true);
    }
  });

  it("L4-AUDIT-3 checklist 勾选项可逐项与证据档案核对", () => {
    // 「逐项核对」：清单中每个引用到层级的勾选项，档案中必须有对应条目。
    expect(fs.existsSync(CHECKLIST_PATH)).toBe(true);
    expect(fs.existsSync(ARCHIVE_PATH)).toBe(true);
    if (!fs.existsSync(CHECKLIST_PATH) || !fs.existsSync(ARCHIVE_PATH)) return;

    const items = parseChecklistLines(fs.readFileSync(CHECKLIST_PATH, "utf-8"));
    const archive = readArchive();
    expect(archive.levels).toBeDefined();
    if (!archive.levels) return;

    const checked = items.filter((i) => i.checked);
    expect(checked.length).toBeGreaterThan(0);
    for (const item of checked) {
      const matched = item.line.match(/(L1\.5|L2|L3|L4)/);
      if (matched) {
        const level = matched[1];
        expect(archive.levels).toHaveProperty(level);
      }
    }
  });
});
