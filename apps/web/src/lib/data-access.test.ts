import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProductAccessState,
  defaultGrantFacet,
  formatDate,
  grantState,
  grantStateLabel,
  granteeOptions,
  institutionName,
  isPendingRequest,
  permissionSummary,
  requestStatusLabel,
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

test("默认分面：有生效中就看生效中；没有就落到第一个有数据的档，避免打开是空列表", () => {
  const empty = grant({ status: "revoked" });
  assert.equal(defaultGrantFacet([]), "active");
  assert.equal(defaultGrantFacet([grant()]), "active");
  assert.equal(defaultGrantFacet([empty]), "revoked");
  assert.equal(defaultGrantFacet([empty, grant({ status: "active", expiresAt: "2020-01-01T00:00:00Z" })]), "expired");
});

test("访问申请状态：待审批/已批准/已拒绝/已撤回", () => {
  assert.equal(requestStatusLabel({ status: "pending" } as never).label, "待审批");
  assert.equal(requestStatusLabel({ status: "approved" } as never).label, "已批准");
  assert.equal(requestStatusLabel({ status: "rejected" } as never).label, "已拒绝");
  assert.equal(requestStatusLabel({ status: "withdrawn" } as never).label, "已撤回");
  assert.equal(isPendingRequest({ status: "pending" } as never), true);
  assert.equal(isPendingRequest({ status: "rejected" } as never), false);
});

test("目录页访问状态：生效授权=已授权，待处理申请=已申请，回收/过期不算", () => {
  const now = Date.parse("2026-11-07T00:00:00Z");
  const state = buildProductAccessState(
    [
      { dataProductId: "dp-1", status: "active" },
      { dataProductId: "dp-2", status: "revoked" },
      { dataProductId: "dp-3", status: "active", expiresAt: "2026-11-01T00:00:00Z" },
    ],
    [
      { id: "r1", dataProductId: "dp-2", providerId: "p", requesterParticipantId: "me", status: "pending" } as never,
      { id: "r2", dataProductId: "dp-3", providerId: "p", requesterParticipantId: "me", status: "approved" } as never,
    ],
    now,
  );
  assert.deepEqual(state.get("dp-1"), { granted: true, pending: false });
  assert.deepEqual(state.get("dp-2"), { granted: false, pending: true });
  // 过期授权与已批准的申请都不构成「已授权/已申请」——目录里应回到「可申请」
  assert.equal(state.get("dp-3"), undefined);
  assert.equal(state.get("dp-4"), undefined);
});
