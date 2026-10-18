import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROUTE_PACK_TAGS,
  SPACE_COOKIE,
  filterNavByEnabledPacks,
  parseCookies,
  parseThemeCookie,
  reconcileSpaceId,
  resolveDocumentTitle,
  serializeThemeCookie,
  spaceHeaders,
  hexToRgb,
  themeCssVariables,
} from "./space-context";

// cookie 里的空间不是本人所属时，后端 SpaceGuard 回 403「无权访问该空间」；
// 早先前端把它当会话拒绝 → 清会话弹 /login?expired=1，坏 cookie 还在 → 死循环。
// 对账函数决定"该把 cookie 改成哪个空间"，这里锁住它的边界。
test("reconcileSpaceId：cookie 空间不属本人时改写成本人空间", () => {
  // 实测场景：cookie 还是 sh-med，用户只剩 hn-power
  assert.equal(reconcileSpaceId("sh-med", ["hn-power"], "hn-power"), "hn-power");
  // 没有默认空间时退回第一个成员空间
  assert.equal(reconcileSpaceId("sh-med", ["hn-power", "bj-med"], null), "hn-power");
});

test("reconcileSpaceId：cookie 合法或无从判断时不动它", () => {
  assert.equal(reconcileSpaceId("hn-power", ["hn-power"], "hn-power"), null);
  assert.equal(reconcileSpaceId(null, ["hn-power"], "hn-power"), "hn-power");
  assert.equal(reconcileSpaceId("anything", [], "hn-power"), null);
  assert.equal(reconcileSpaceId("anything", undefined, undefined), null);
  assert.equal(reconcileSpaceId("", [], null), null);
});

test("parseCookies：解析 Cookie 头", () => {
  const c = parseCookies(`${SPACE_COOKIE}=sh-med; medtrust_space_theme=%7B%22title%22%3A%22A%22%7D`);
  assert.equal(c[SPACE_COOKIE], "sh-med");
  assert.equal(JSON.parse(c.medtrust_space_theme).title, "A");
  assert.deepEqual(parseCookies(null), {});
});

test("主题 cookie：白名单外的键被丢弃（不可注入任意样式）", () => {
  const t = parseThemeCookie(JSON.stringify({ title: "A", css: "body{color:red}", primary: "#3fb6ae" }));
  assert.deepEqual(Object.keys(t!).sort(), ["primary", "title"]);
});

test("负例：非法颜色 / 外链图片 / 超长值一律丢弃", () => {
  assert.equal(parseThemeCookie(JSON.stringify({ primary: "red" })), null);
  assert.equal(parseThemeCookie(JSON.stringify({ logoKey: "https://evil/x.png" })), null);
  assert.equal(parseThemeCookie(JSON.stringify({ title: "x".repeat(500) })), null);
  assert.equal(parseThemeCookie("not-json"), null);
  assert.equal(parseThemeCookie(JSON.stringify(["a"])), null);
});

test("序列化会先过校验（写端也不会写入非法值）", () => {
  assert.equal(serializeThemeCookie({ title: "A", primary: "red" } as never), JSON.stringify({ title: "A" }));
});

test("resolveDocumentTitle：主题优先，回退默认", () => {
  assert.equal(resolveDocumentTitle({ title: "某省电力可信数据空间" }), "某省电力可信数据空间");
  assert.equal(resolveDocumentTitle({ shortName: "车网" }), "车网");
  assert.equal(resolveDocumentTitle(null), "MedTrust 可信数据空间");
});

test("spaceHeaders：无空间时不带头", () => {
  assert.deepEqual(spaceHeaders("s1"), { "X-Space-Id": "s1" });
  assert.deepEqual(spaceHeaders(null), {});
});

test("主题令牌 → CSS 变量：只映射契约变量，并由主色派生 dim/glow", () => {
  const vars = themeCssVariables({ primary: "#3fb6ae", accent: "#22c55e", title: "A" });
  assert.deepEqual(Object.keys(vars).sort(), ["--cs-cyan", "--cs-cyan-dim", "--cs-glow", "--cs-green"]);
  assert.equal(vars["--cs-cyan"], "#3fb6ae");
  assert.match(vars["--cs-cyan-dim"], /^rgba\(63,182,174,0\.15\)$/);
  assert.equal(vars["--cs-green"], "#22c55e");
  assert.deepEqual(themeCssVariables(null), {});
  assert.deepEqual(themeCssVariables({ primary: "red" as never }), {});
});

test("hexToRgb：非法输入返回 null", () => {
  assert.deepEqual(hexToRgb("#000000"), [0, 0, 0]);
  assert.equal(hexToRgb("black"), null);
  assert.equal(hexToRgb("#fff"), null);
});

test("ROUTE_PACK_TAGS：医疗专属页登记为需要 med 包", () => {
  assert.deepEqual(ROUTE_PACK_TAGS["/space/rbqm"], ["med"]);
  assert.equal(ROUTE_PACK_TAGS["/space/catalog"], undefined); // 基座页不打标签
});

test("导航过滤：未启用所需包的路由被隐藏，基座路由始终可见", () => {
  const entries = [
    { route: "/space/catalog" },
    { route: "/space/rbqm" },
    { route: "/space/atlas" },
  ];
  const tags = { "/space/rbqm": ["med"] };
  assert.deepEqual(
    filterNavByEnabledPacks(entries, ["med"], tags).map((e) => e.route),
    ["/space/catalog", "/space/rbqm", "/space/atlas"],
  );
  assert.deepEqual(
    filterNavByEnabledPacks(entries, [], tags).map((e) => e.route),
    ["/space/catalog", "/space/atlas"],
  );
});
