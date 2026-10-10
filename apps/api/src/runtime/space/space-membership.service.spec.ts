import { createHash } from "node:crypto";
import { SpaceMembershipService } from "./space-membership.service";

function repo(seed: any[] = []) {
  const rows = seed;
  let seq = 0;
  const match = (r: any, where: any) =>
    Object.entries(where ?? {}).every(([k, v]) => r[k] === v);
  return {
    rows,
    create: (x: any) => ({ ...x }),
    save: async (x: any) => {
      if (!x.id) x.id = "id-" + ++seq;
      const i = rows.findIndex((r) => r.id === x.id);
      if (i >= 0) rows[i] = x;
      else rows.push(x);
      return x;
    },
    find: async (o: any) => rows.filter((r) => match(r, o?.where)),
    findOne: async (o: any) => rows.find((r) => match(r, o?.where)) ?? null,
  } as any;
}

const hashingGm = {
  sm3Hash: (s: string) => createHash("sha256").update(s).digest("hex"),
} as any;

function makeService() {
  const members = repo();
  const invitations = repo();
  const svc = new SpaceMembershipService(members, invitations, hashingGm);
  return { svc, members, invitations };
}

describe("SpaceMembershipService（P6 / D-SPD-14）", () => {
  it("邀请：token 不可枚举且只存哈希，明文只出现一次", async () => {
    const { svc, invitations } = makeService();
    const a = await svc.invite({
      spaceId: "s1",
      subjectType: "org",
      invitee: "p-huashan",
      role: "data-provider",
    });
    const b = await svc.invite({
      spaceId: "s1",
      subjectType: "org",
      invitee: "p-ruijin",
      role: "data-provider",
    });
    expect(a.token.length).toBeGreaterThanOrEqual(32);
    expect(a.token).not.toEqual(b.token); // 不可枚举/不可预测
    expect(a.invitation.tokenHash).not.toContain(a.token); // 明文不入库
    expect(a.invitation.tokenHash).toBe(hashingGm.sm3Hash(a.token));
    expect(invitations.rows).toHaveLength(2);
    expect(a.invitation.status).toBe("pending");
    expect(a.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("接受邀请：一次性——重放即拒", async () => {
    const { svc, members } = makeService();
    const { token } = await svc.invite({
      spaceId: "s1",
      subjectType: "org",
      invitee: "p-huashan",
      role: "data-provider",
    });
    const member = await svc.acceptInvitation(token, {
      subjectType: "org",
      subjectId: "p-huashan",
    });
    expect(member.status).toBe("active");
    expect(member.spaceId).toBe("s1");
    expect(members.rows).toHaveLength(1);
    await expect(
      svc.acceptInvitation(token, {
        subjectType: "org",
        subjectId: "p-huashan",
      }),
    ).rejects.toThrow(/已被使用或已失效/);
  });

  it("负例：过期邀请被拒并标记 expired", async () => {
    const { svc, invitations } = makeService();
    const { token } = await svc.invite({
      spaceId: "s1",
      subjectType: "org",
      invitee: "p-huashan",
      role: "data-provider",
    });
    // 回拨过期时间：服务端对非法 ttl 会回落默认，故直接构造"已过期"状态
    invitations.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(
      svc.acceptInvitation(token, {
        subjectType: "org",
        subjectId: "p-huashan",
      }),
    ).rejects.toThrow(/已过期/);
    expect(invitations.rows[0].status).toBe("expired");
  });

  it("负例：接受者主体与被邀主体不符即拒（防转发）", async () => {
    const { svc } = makeService();
    const { token } = await svc.invite({
      spaceId: "s1",
      subjectType: "org",
      invitee: "p-huashan",
      role: "data-provider",
    });
    await expect(
      svc.acceptInvitation(token, {
        subjectType: "org",
        subjectId: "p-ruijin",
      }),
    ).rejects.toThrow(/不符/);
    await expect(
      svc.acceptInvitation(token, {
        subjectType: "user",
        subjectId: "p-huashan",
      }),
    ).rejects.toThrow(/不符/);
  });

  it("负例：无效 token 返回不存在（不区分不存在与已失效之外的信息）", async () => {
    const { svc } = makeService();
    await expect(
      svc.acceptInvitation("not-a-real-token", {
        subjectType: "org",
        subjectId: "p-huashan",
      }),
    ).rejects.toThrow(/无效/);
  });

  it("成员关系：幂等加入 + 一人多空间可解析", async () => {
    const { svc, members } = makeService();
    await svc.addMember({
      spaceId: "s1",
      subjectType: "org",
      subjectId: "p-huashan",
      role: "data-provider",
    });
    await svc.addMember({
      spaceId: "s1",
      subjectType: "org",
      subjectId: "p-huashan",
      role: "auditor",
    });
    await svc.addMember({
      spaceId: "s2",
      subjectType: "org",
      subjectId: "p-huashan",
      role: "data-provider",
    });
    await svc.addMember({
      spaceId: "s3",
      subjectType: "org",
      subjectId: "p-other",
      role: "data-provider",
    });
    expect(members.rows).toHaveLength(3);
    expect(members.rows[0].role).toBe("auditor"); // 幂等覆盖
    expect(await svc.spacesOfSubject("org", "p-huashan")).toEqual(["s1", "s2"]);
  });

  it("负例：被暂停成员不计入所属空间", async () => {
    const { svc } = makeService();
    await svc.addMember({
      spaceId: "s1",
      subjectType: "user",
      subjectId: "42",
      role: "member",
      status: "suspended",
    });
    expect(await svc.spacesOfSubject("user", "42")).toEqual([]);
  });
});
