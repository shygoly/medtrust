// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

import { powerTemplates, registerPowerTemplates } from "./index";
import { powerAggregationCollectors, registerPowerCollectors } from "../collectors";

describe("模板与收集器注册", () => {
  it("声明三个计划模板", () => {
    expect(powerTemplates().map((t) => t.id)).toEqual([
      "power.load-forecast",
      "power.demand-response",
      "power.theft-detection",
    ]);
  });

  it("registerPowerTemplates / registerPowerCollectors 可调用", () => {
    const tids: string[] = [];
    const ctypes: string[] = [];
    registerPowerTemplates({
      register: (t) => {
        tids.push(t.id);
      },
      resolve: () => undefined,
    });
    registerPowerCollectors({
      register: (c) => {
        ctypes.push(c.analysisType);
      },
      resolve: () => undefined,
    });
    expect(tids).toHaveLength(3);
    expect(powerAggregationCollectors().length).toBeGreaterThanOrEqual(2);
    expect(ctypes).toEqual(expect.arrayContaining(["power.load-forecast", "power.theft-detection"]));
  });
});
