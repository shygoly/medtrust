import test from "node:test";
import assert from "node:assert/strict";

import { toAttestationRows } from "./attestations.mjs";

test("maps API attestations to ledger display rows", () => {
  const rows = toAttestationRows([
    {
      id: 7,
      attestation_type: "custom",
      status: "confirmed",
      data_id: "chainmaker-final-1782718157",
      data_hash: "cbcdf5e826856ddaf01d30138d07b36d8b2db5ce0d7e8858838ca3f31f7dfc46",
      transaction_hash: "66039ce4266a48d5424f4392d6c6aa60feda8261632c2d1c4099b0d2e566f60c",
      block_number: 5,
      metadata: { source: "api-final-phase4" },
    },
  ]);

  assert.deepEqual(rows, [
    {
      id: 7,
      type: "CUSTOM",
      status: "CONFIRMED",
      dataId: "chainmaker-final-1782718157",
      dataHash: "cbcdf5e826856ddaf01d30138d07b36d8b2db5ce0d7e8858838ca3f31f7dfc46",
      txHash: "66039ce4266a48d5424f4392d6c6aa60feda8261632c2d1c4099b0d2e566f60c",
      blockNumber: 5,
      metadataSummary: "source=api-final-phase4",
    },
  ]);
});

test("uses explicit placeholders for pending records", () => {
  const rows = toAttestationRows([
    {
      id: 8,
      attestation_type: "medical_record",
      status: "pending",
      data_hash: "abc123",
      transaction_hash: null,
      block_number: null,
      metadata: null,
    },
  ]);

  assert.equal(rows[0].dataId, "ATTESTATION-8");
  assert.equal(rows[0].txHash, "pending");
  assert.equal(rows[0].blockNumber, null);
  assert.equal(rows[0].metadataSummary, "none");
});
