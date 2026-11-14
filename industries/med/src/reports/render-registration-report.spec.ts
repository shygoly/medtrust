// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  buildRegistrationReport,
  type RegistrationReportInput,
} from "./registration-report";
import {
  renderRegistrationReportHtml,
  renderRegistrationReportMarkdown,
} from "./render-registration-report";

function fixture(): RegistrationReportInput {
  const candidates = [
    resolve(process.cwd(), "scripts/test/fixtures/registration-report/input.json"),
    resolve(
      __dirname,
      "../../../../scripts/test/fixtures/registration-report/input.json",
    ),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as RegistrationReportInput;
    } catch {
      // Try the next workspace-relative location.
    }
  }
  throw new Error("registration report fixture not found");
}

describe("registration report renderers", () => {
  it("renders every canonical section deterministically", () => {
    const report = buildRegistrationReport(fixture());
    const markdown = renderRegistrationReportMarkdown(report);
    const html = renderRegistrationReportHtml(report);

    assert.equal(markdown, renderRegistrationReportMarkdown(report));
    assert.equal(html, renderRegistrationReportHtml(report));
    for (const heading of [
      "文档控制",
      "执行结论",
      "敏感性分析",
      "真值与异质性",
      "执行与证据链",
      "AI 交互截图附录",
    ])
      assert.match(markdown, new RegExp(heading));
    assert.match(markdown, /SIMULATION ONLY/);
    assert.match(html, /SIMULATION ONLY/);
    assert.match(markdown, new RegExp(report.reportFingerprint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("does not leak row-level keys into rendered output", () => {
    const report = buildRegistrationReport(fixture());
    const output = `${renderRegistrationReportMarkdown(report)}\n${renderRegistrationReportHtml(report)}`;
    assert.doesNotMatch(output, /linkKey|subjectKey|patientId|personId/i);
  });
});
