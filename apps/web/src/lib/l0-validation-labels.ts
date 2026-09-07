// TypeScript re-export of the .mjs labeling helpers so Next.js / tsx pages
// can import them with full types. The .mjs file is the canonical source
// (the node:test runner in `pnpm --filter web test` only picks up *.mjs).
//
// See l0-validation-labels.mjs for the labeling contract this preserves.
export {
  provenanceLabel,
  submissionWarning,
  suppressionExplanation,
  l0ResultFootnote,
} from "./l0-validation-labels.mjs";
