// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

/**
 * Public renderer surface for the canonical registration report.
 *
 * The implementation lives beside the schema so JSON assembly and rendering
 * cannot diverge through a copied type definition. Renderers are pure and
 * consume only the normalized report returned by buildRegistrationReport().
 */
export {
  renderRegistrationReportHtml,
  renderRegistrationReportMarkdown,
} from "./registration-report";
