import test from "node:test";
import assert from "node:assert/strict";
import {
  formatDate,
  grantState,
  grantStateLabel,
  granteeOptions,
  institutionName,
  permissionSummary,
  type AccessGrantRow,
} from "./data-access";

function grant(over: Partial<AccessGrantRow> = {}): AccessGrantRow {
  return {
    id: "g1",
    dataProductId: "dp-1",
    providerId: "p-demohospa",
    granteeParticipantId: "p-meddata",
    permissions: ["compute"],
    status: "active",
    ...over,
  };
}

test("授权状态：回收优先，其次看到期时间", () => {
  const now = Date.parse("2026-11-06T00:00:00Z");
  assert.equal(grantState(grant(), now), "active");
  assert.equal(grantState(grant({ expiresAt: "2026-11-05T23:59:59Z" }), now), "expired");
  assert.equal(grantState(grant({ expiresAt: "2026-12-01T00:00:00Z" }), now), "active");
  // 已回收的行即使 expiresAt 还在将来，也应显示已回收
  assert.equal(grantState(grant({ status: "revoked", expiresAt: "2026-12-01T00:00:00Z" }), now), "revoked");
  assert.equal(grantStateLabel(grant({ status: "revoked" }), now).label, "已回收");
});

test("权限位中文：缺省按 compute（与服务端 DEFAULT_ACCESS_PERMISSIONS 一致）", () => {
  assert.equal(permissionSummary(["catalog"]), "查看目录");
  assert.equal(permissionSummary(["catalog", "compute"]), "查看目录 · 可计算");
  assert.equal(permissionSummary([]), "可计算");
  assert.equal(permissionSummary(undefined), "可计算");
});

test("机构名查不到回退 slug，不显示空白", () => {
  const map = new Map([["p-meddata", "医研数据研究院"]]);
  assert.equal(institutionName(map, "p-meddata"), "医研数据研究院");
  assert.equal(institutionName(map, "p-unknown"), "p-unknown");
});

test("授权对象候选：排除提供方自己与没有 slug 的旧行，按机构名排序去重", () => {
  const options = granteeOptions(
    [
      { id: "1", participantId: "p-meddata", org: "医研数据研究院" },
      { id: "2", participantId: "p-demohospa", org: "示范甲医院" },
      { id: "3", participantId: "p-meddata", org: "医研数据研究院（重复）" },
      { id: "4", participantId: null, org: "没有 slug 的旧行" },
      { id: "5", participantId: "p-smartmed", org: "智慧医疗AI" },
    ],
    "p-demohospa",
  );
  assert.deepEqual(options.map((o) => o.participantId), ["p-meddata", "p-smartmed"]);
});

test("日期只到天；非法值返回 null", () => {
  assert.match(formatDate("2026-11-06T10:20:30Z")!, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(formatDate(null), null);
  assert.equal(formatDate("nope"), null);
});
