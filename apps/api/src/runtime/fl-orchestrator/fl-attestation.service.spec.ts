import { Test } from "@nestjs/testing";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { AttestationService } from "../digital-contract/attestation.service";
import { FlAttestationService } from "./fl-attestation.service";
import {
  mergeFlPartyResults,
  buildMockFlPartyRunResult,
} from "../../compute-task/dto/fl-run-result";
import { ckdEsrdRiskFlPredictionSpec } from "../../compute-task/dto/fl-prediction-task-spec";

describe("FlAttestationService", () => {
  it("anchors SM3 report hash for merged FL result", async () => {
    const gm = {
      sm3Hash: jest.fn((s: string) => `hash-${s.length}`),
    } as unknown as GMCryptoService;
    const attestation = {
      anchor: jest.fn(() =>
        Promise.resolve({ txHash: "0xabc", block: 42, hash: "SM3:test" }),
      ),
    } as unknown as AttestationService;
    const svc = new FlAttestationService(gm, attestation);
    const spec = ckdEsrdRiskFlPredictionSpec();
    const merged = mergeFlPartyResults(
      [
        buildMockFlPartyRunResult("t1", "p-huashan", 50, 5),
        buildMockFlPartyRunResult("t1", "p-ruijin", 40, 5),
      ],
      spec,
    );
    const out = await svc.attestMergedResult(merged, "t1");
    expect(out.attestation?.reportHash).toMatch(/^SM3:/);
    expect(out.attestation?.chainTxHash).toBe("0xabc");
    expect(gm.sm3Hash).toHaveBeenCalled();
  });
});
