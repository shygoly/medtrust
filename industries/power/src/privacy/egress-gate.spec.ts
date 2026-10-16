// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { PowerPrivacyError } from "./dp";
import { enforcePowerEgress } from "./egress-gate";

describe("出域闸 enforcePowerEgress", () => {
  it("串联 minCell + k + DP", () => {
    const r = enforcePowerEgress(
      { nSamples: 10, numericPayload: [1, 2, 3] },
      { scenario: "load-forecast", dpEpsilon: 0.5, seed: "g1" },
    );
    expect(r.released).toBe(true);
    expect(r.dp?.dpApplied).toBe(true);
    expect(r.dp!.dpEpsilon).toBeLessThan(1.0);
  });

  it("样本量不足时拒绝", () => {
    expect(() =>
      enforcePowerEgress(
        { nSamples: 3 },
        { scenario: "demand-response" },
      ),
    ).toThrow(PowerPrivacyError);
  });
});
