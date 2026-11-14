#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * SM3 摘要（证据包清单用）。
 *
 * 走 `node:crypto` 而非直引 `sm-crypto`：Node ≥20 的 OpenSSL 3 原生支持 SM3，
 * 摘要与 `sm-crypto.sm3` 逐位一致（已核对）。这样构建脚本不构成第二个国密实现入口，
 * TRUST.md 红线 1（`sm-crypto` 引用白名单）不需要为它开口子。
 */
const sm3 = (input) => {
  try {
    return createHash("sm3").update(input).digest("hex");
  } catch (error) {
    throw new Error(
      `当前 Node 的 OpenSSL 不支持 SM3（需要 OpenSSL 3 / Node ≥20 官方构建）：${error?.message ?? error}`,
    );
  }
};
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
};

const inputPath = flag("--input");
const outDir = flag("--out");
const screenshotRoot = flag("--screenshot-root");
const fixturesDir = flag("--fixtures");
const executionPath = flag("--execution");
const expectedFingerprint = flag("--expected-fingerprint");
const jsonOnly = argv.includes("--json-only");
const htmlOnly = argv.includes("--html-only");
const includeDocx = argv.includes("--docx");
if (!outDir) {
  console.error(
    "usage: node scripts/build-rwd-registration-report.mjs [--input <input.json> | --fixtures <dir>] --out <directory> [--screenshot-root <dir>] [--execution <job-evidence.json>] [--json-only|--html-only] [--docx] [--expected-fingerprint <sm3:...>]",
  );
  process.exit(2);
}

const {
  buildRegistrationReport,
  renderRegistrationReportHtml,
  renderRegistrationReportMarkdown,
} = await import(
  join(ROOT, "industries", "med", "dist", "reports", "registration-report.js")
);

const resolvedInputPath = inputPath
  ? resolve(inputPath)
  : join(
      resolve(
        fixturesDir ??
          join(ROOT, "scripts", "test", "fixtures", "registration-report"),
      ),
      "input.json",
    );
const input = JSON.parse(readFileSync(resolvedInputPath, "utf8"));
if (executionPath) {
  const execution = JSON.parse(readFileSync(resolve(executionPath), "utf8"));
  input.execution = execution.execution ?? execution;
}
const report = buildRegistrationReport(input);
if (
  expectedFingerprint &&
  report.reportFingerprint !== expectedFingerprint
) {
  console.error(
    `report fingerprint drift: expected ${expectedFingerprint}, received ${report.reportFingerprint}`,
  );
  process.exitCode = 1;
  process.exit(1);
}
const markdown = renderRegistrationReportMarkdown(report);
const html = renderRegistrationReportHtml(report);

mkdirSync(outDir, { recursive: true });
const screenshotDir = join(outDir, "screenshots");
mkdirSync(screenshotDir, { recursive: true });
if (screenshotRoot) {
  for (const screenshot of report.assistantSession.screenshots) {
    const source = resolve(screenshotRoot, basename(screenshot.screenshot));
    if (!existsSync(source))
      throw new Error(`missing assistant screenshot for ${screenshot.stepId}: ${source}`);
    const actual = createHash("sha256").update(readFileSync(source)).digest("hex");
    if (actual !== screenshot.screenshotSha256)
      throw new Error(
        `assistant screenshot digest mismatch for ${screenshot.stepId}: expected ${screenshot.screenshotSha256}, received ${actual}`,
      );
    copyFileSync(source, join(screenshotDir, basename(source)));
  }
}

const chartFiles = renderCharts(report);
const outputs = jsonOnly
  ? [["registration-report.json", JSON.stringify(report, null, 2) + "\n"]]
  : htmlOnly
    ? [["report.html", html]]
    : [
        ["registration-report.json", JSON.stringify(report, null, 2) + "\n"],
        ["report.md", markdown],
        ["report.html", html],
        ...chartFiles.map(([name, text]) => [`charts/${name}`, text]),
      ];
for (const [name, text] of outputs) {
  const target = join(outDir, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
}

const binaryOutputs = [];
if (includeDocx) {
  const python = process.env.CODEX_PYTHON || "python3";
  const docxScript = join(ROOT, "scripts", "build-rwd-registration-report-docx.py");
  const docxPath = join(outDir, "report.docx");
  const built = spawnSync(
    python,
    [docxScript, "--input", resolve(outDir), "--out", docxPath],
    { stdio: "inherit" },
  );
  if (built.status !== 0)
    throw new Error(
      `DOCX generation failed with exit code ${String(built.status ?? "unknown")}`,
    );
  binaryOutputs.push({
    name: "report.docx",
    data: readFileSync(docxPath),
  });
}

const manifest = {
  schema: "medtrust.rwd-registration-report-manifest/v1",
  generatedAt: report.metadata.generatedAt,
  syntheticOnly: report.metadata.syntheticOnly,
  reportFingerprint: report.reportFingerprint,
  files: [
    ...outputs.map(([name, text]) => ({
      name,
      bytes: Buffer.byteLength(text),
      sm3: sm3(text),
      sha256: createHash("sha256").update(text).digest("hex"),
    })),
    ...binaryOutputs.map(({ name, data }) => ({
      name,
      bytes: data.length,
      sm3: sm3(data.toString("base64")),
      sha256: createHash("sha256").update(data).digest("hex"),
    })),
  ],
  screenshots: report.assistantSession.screenshots.map((shot) => ({
    stepId: shot.stepId,
    file: `screenshots/${basename(shot.screenshot)}`,
    sha256: shot.screenshotSha256,
    credentialDisplay: shot.credentialDisplay,
  })),
};
writeFileSync(
  join(outDir, "report-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);
console.log(`RWD registration report: ${report.reportFingerprint}`);
console.log(`Output: ${resolve(outDir)}`);

function renderCharts(value) {
  const balance = value.diagnostics.balance;
  const width = 760;
  const rowHeight = 34;
  const height = 70 + balance.length * rowHeight;
  const max = Math.max(0.2, ...balance.flatMap((row) => [row.smdBefore, row.smdAfter])) * 1.1;
  const x = (v) => 120 + (Math.abs(v) / max) * 560;
  const bars = balance
    .flatMap((row, index) => {
      const y = 50 + index * rowHeight;
      return [
        `<text x="10" y="${y + 5}" font-size="12">${escapeXml(row.covariate)}</text>`,
        `<line x1="120" y1="${y - 5}" x2="${x(row.smdBefore)}" y2="${y - 5}" stroke="#64748b" stroke-width="8" opacity=".45"/>`,
        `<line x1="120" y1="${y + 6}" x2="${x(row.smdAfter)}" y2="${y + 6}" stroke="#2563eb" stroke-width="8"/>`,
        `<text x="${x(row.smdBefore) + 6}" y="${y - 1}" font-size="10">${row.smdBefore.toFixed(2)}</text>`,
        `<text x="${x(row.smdAfter) + 6}" y="${y + 12}" font-size="10">${row.smdAfter.toFixed(2)}</text>`,
      ];
    })
    .join("");
  const balanceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<style>text{font-family:-apple-system,PingFang SC,sans-serif;fill:#0f172a}</style>
<text x="10" y="20" font-size="16" font-weight="700">SMD before / after weighting</text>
<text x="120" y="38" font-size="11" fill="#64748b">gray=before, blue=after</text>
${bars}</svg>`;

  const estimates = [
    ["primary", value.result.riskRatio, value.result.riskRatioCi],
    ...value.sensitivity.map((row) => [row.id, row.estimate, [row.ciLow, row.ciHigh]]),
  ];
  const forestHeight = 70 + estimates.length * 38;
  const forestX = (v) => 120 + ((v - 0.4) / 0.8) * 560;
  const forest = estimates
    .map(([label, estimate, interval], index) => {
      const y = 50 + index * 38;
      return `<text x="10" y="${y + 4}" font-size="11">${escapeXml(String(label))}</text>
<line x1="${forestX(interval[0])}" y1="${y}" x2="${forestX(interval[1])}" y2="${y}" stroke="#334155" stroke-width="2"/>
<circle cx="${forestX(estimate)}" cy="${y}" r="5" fill="#2563eb"/>
<line x1="${forestX(1)}" y1="35" x2="${forestX(1)}" y2="${forestHeight - 20}" stroke="#dc2626" stroke-dasharray="4 4"/>`;
    })
    .join("");
  const forestSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${forestHeight}">
<style>text{font-family:-apple-system,PingFang SC,sans-serif;fill:#0f172a}</style>
<text x="10" y="20" font-size="16" font-weight="700">Primary and sensitivity risk ratios</text>
${forest}</svg>`;

  const cohort = value.cohort;
  const cohortSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="250">
<style>text{font-family:-apple-system,PingFang SC,sans-serif;fill:#0f172a}</style>
<text x="10" y="24" font-size="16" font-weight="700">Cohort flow</text>
<rect x="20" y="55" width="180" height="54" rx="8" fill="#eff6ff" stroke="#2563eb"/>
<text x="35" y="78" font-size="12">Trial source</text><text x="35" y="97" font-size="14" font-weight="700">${cohort.trialN}</text>
<rect x="20" y="145" width="180" height="54" rx="8" fill="#f8fafc" stroke="#64748b"/>
<text x="35" y="168" font-size="12">Control pool</text><text x="35" y="187" font-size="14" font-weight="700">${cohort.controlPoolN}</text>
<line x1="200" y1="82" x2="330" y2="82" stroke="#94a3b8"/><polygon points="330,82 320,77 320,87" fill="#94a3b8"/>
<line x1="200" y1="172" x2="330" y2="172" stroke="#94a3b8"/><polygon points="330,172 320,167 320,177" fill="#94a3b8"/>
<rect x="340" y="55" width="180" height="54" rx="8" fill="#ecfdf5" stroke="#059669"/>
<text x="355" y="78" font-size="12">Analysis trial</text><text x="355" y="97" font-size="14" font-weight="700">${cohort.analysisTrialN}</text>
<rect x="340" y="145" width="180" height="54" rx="8" fill="#ecfdf5" stroke="#059669"/>
<text x="355" y="168" font-size="12">Analysis control</text><text x="355" y="187" font-size="14" font-weight="700">${cohort.analysisControlN}</text>
<text x="540" y="92" font-size="11" fill="#64748b">exclusions: ${escapeXml(cohort.exclusions.map((row) => `${row.reason}=${row.count}`).join("; "))}</text>
</svg>`;

  const overlap = value.diagnostics.overlap;
  const overlapX = (v) => 80 + ((v - 0) / 1) * 600;
  const overlapSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="150">
<style>text{font-family:-apple-system,PingFang SC,sans-serif;fill:#0f172a}</style>
<text x="10" y="22" font-size="16" font-weight="700">Propensity overlap</text>
<line x1="${overlapX(0)}" y1="70" x2="${overlapX(1)}" y2="70" stroke="#cbd5e1" stroke-width="8"/>
<line x1="${overlapX(overlap.minPropensity)}" y1="70" x2="${overlapX(overlap.maxPropensity)}" y2="70" stroke="#2563eb" stroke-width="8"/>
<circle cx="${overlapX(overlap.minPropensity)}" cy="70" r="5" fill="#1d4ed8"/><circle cx="${overlapX(overlap.maxPropensity)}" cy="70" r="5" fill="#1d4ed8"/>
<text x="${overlapX(0)}" y="95" font-size="11">0</text><text x="${overlapX(1) - 8}" y="95" font-size="11">1</text>
<text x="80" y="120" font-size="12">range ${overlap.minPropensity.toFixed(3)}–${overlap.maxPropensity.toFixed(3)} · trimmed ${overlap.trimmed} · ESS trial ${overlap.eesTrial.toFixed(1)} / control ${overlap.eesControl.toFixed(1)}</text>
</svg>`;

  const weights = value.diagnostics.weights;
  const weightMax = Math.max(weights.maxWeight, weights.p99Weight, 1) * 1.2;
  const weightX = (v) => 80 + (v / weightMax) * 600;
  const weightsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="150">
<style>text{font-family:-apple-system,PingFang SC,sans-serif;fill:#0f172a}</style>
<text x="10" y="22" font-size="16" font-weight="700">Weight diagnostics</text>
<line x1="${weightX(0)}" y1="70" x2="${weightX(weightMax)}" y2="70" stroke="#cbd5e1" stroke-width="4"/>
<line x1="${weightX(weights.p99Weight)}" y1="55" x2="${weightX(weights.p99Weight)}" y2="85" stroke="#d97706" stroke-width="3"/>
<line x1="${weightX(weights.maxWeight)}" y1="50" x2="${weightX(weights.maxWeight)}" y2="90" stroke="#dc2626" stroke-width="3"/>
<text x="${weightX(weights.p99Weight) - 20}" y="110" font-size="11">P99 ${weights.p99Weight.toFixed(2)}</text>
<text x="${weightX(weights.maxWeight) - 20}" y="128" font-size="11">max ${weights.maxWeight.toFixed(2)}</text>
<text x="80" y="42" font-size="11">truncated ${(weights.truncatedFraction * 100).toFixed(1)}% · effective n ${weights.effectiveSampleSize.toFixed(1)}</text>
</svg>`;

  const secondary =
    value.heterogeneity.secondaryRr === null
      ? "not available"
      : value.heterogeneity.secondaryRr.toFixed(3);
  const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="170">
<style>text{font-family:-apple-system,PingFang SC,sans-serif;fill:#0f172a}</style>
<text x="10" y="22" font-size="16" font-weight="700">Primary vs secondary source RR</text>
<text x="20" y="70" font-size="12">Primary</text>
<rect x="120" y="55" width="${Math.max(2, value.heterogeneity.primaryRr * 300)}" height="22" fill="#2563eb"/>
<text x="${125 + value.heterogeneity.primaryRr * 300}" y="71" font-size="12">${value.heterogeneity.primaryRr.toFixed(3)}</text>
<text x="20" y="115" font-size="12">Secondary</text>
<rect x="120" y="100" width="${Math.max(2, (value.heterogeneity.secondaryRr ?? 0) * 300)}" height="22" fill="#64748b"/>
<text x="430" y="116" font-size="12">${escapeXml(secondary)}</text>
<text x="120" y="150" font-size="11" fill="#64748b">${escapeXml(value.heterogeneity.conclusion)}</text>
</svg>`;
  return [
    ["cohort-flow.svg", cohortSvg],
    ["overlap-propensity.svg", overlapSvg],
    ["balance-smd.svg", balanceSvg],
    ["weight-diagnostics.svg", weightsSvg],
    ["effect-forest.svg", forestSvg],
    ["source-comparison.svg", sourceSvg],
  ];
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
