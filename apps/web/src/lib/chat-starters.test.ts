import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MED_STARTERS,
  POWER_STARTERS,
  startersForSpace,
} from "./chat-starters";

test("医疗空间只出医疗预设，覆盖外部对照/注册/联邦/队列", () => {
  const starters = startersForSpace({ enabledPacks: ["med"], spaceId: "sh-med" });
  assert.deepEqual(starters, [...MED_STARTERS]);
  assert.equal(starters.length, 4);
  assert.ok(starters.every((s) => !/电力|负荷|窃电|削峰/.test(s)));
});

test("电力空间只出电力预设，覆盖负荷/需求响应/窃电", () => {
  const starters = startersForSpace({ enabledPacks: ["power"], spaceId: "hn-power" });
  assert.deepEqual(starters, [...POWER_STARTERS]);
  assert.equal(starters.length, 3);
  assert.ok(starters.every((s) => !/医院|对照|联邦|队列|注册/.test(s)));
});

test("双包空间拼接医疗+电力", () => {
  const starters = startersForSpace({
    enabledPacks: ["med", "power"],
    spaceId: "demo",
  });
  assert.deepEqual(starters, [...MED_STARTERS, ...POWER_STARTERS]);
});

test("enabledPacks 未加载时按 spaceId 启发式", () => {
  assert.deepEqual(startersForSpace({ spaceId: "hn-power" }), [...POWER_STARTERS]);
  assert.deepEqual(startersForSpace({ spaceId: "sh-med" }), [...MED_STARTERS]);
  assert.deepEqual(startersForSpace({}), [...MED_STARTERS]);
});
