import test from "node:test";
import assert from "node:assert/strict";
import { explainSubmitError, normaliseError } from "./submit-error";

test("错误归一：Error / 数组 / 字符串都能读，空值返回 null", () => {
  assert.equal(normaliseError(new Error("boom")), "boom");
  assert.equal(normaliseError(["a", "b"]), "a；b");
  assert.equal(normaliseError("x"), "x");
  assert.equal(explainSubmitError(""), null);
  assert.equal(explainSubmitError(undefined), null);
});

test("预审五类拒绝都给「原因 + 下一步」，不是只甩原文", () => {
  const cases: Array<[string, string]> = [
    ["合约 c1 无合规预审快照：不能用于创建新任务，请重新申请带预审的合约", "/space/contracts"],
    ["合约 c1 的预审组合 comp-1 缺失，请重新申请", "/space/atlas/pre-review"],
    ["合约 c1 的预审复评失败（组合或规则缺失），请重新申请", "/space/atlas/pre-review"],
    ["合约 c1 的预审未覆盖分析类型「rws.causal-psm」：超出预审范围或该类型未登记能力映射", "/space/atlas/pre-review"],
    ["合约 c1 任务准入复审驳回：命中 block-cross-inst-low-k", "/space/atlas/pre-review"],
    ["合约 c1 复评为需审批，但合约无医院确认，不予放行", "/space/contracts"],
  ];
  for (const [raw, href] of cases) {
    const hint = explainSubmitError(raw);
    assert.ok(hint, raw);
    assert.ok(hint!.action, `应给下一步：${raw}`);
    assert.equal(hint!.action!.href, href);
    assert.ok(hint!.detail.length > 5);
  }
});

test("不认识的错误原样展示，不吞信息", () => {
  const hint = explainSubmitError("ECONNRESET");
  assert.deepEqual(hint, { title: "提交被拒绝", detail: "ECONNRESET" });
});

test("Nest 校验数组也能读成一句", () => {
  const hint = explainSubmitError(["contractIds should not be empty", "title should be a string"]);
  assert.equal(hint?.title, "提交被拒绝");
  assert.match(hint!.detail, /contractIds/);
});
