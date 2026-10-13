import { ForbiddenException } from "@nestjs/common";
import { SpaceAccessGuard } from "./space-access.guard";

function ctx(
  params: { spaceId?: string; id?: string },
  path = "/:spaceId/members",
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        params,
        route: { path },
        user: { userId: 5, participantId: "p-health-gov", role: "operator" },
      }),
    }),
  } as never;
}

describe("SpaceAccessGuard", () => {
  it("rejects a medical operator who is not a member of the power space", async () => {
    const membership = {
      roleFor: async () => null,
      hasAnyMembership: async () => true,
    };
    const guard = new SpaceAccessGuard(membership as never);
    await expect(
      guard.canActivate(ctx({ spaceId: "hn-power" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows a member and records the space role", async () => {
    const req = {
      params: { spaceId: "hn-power" },
      route: { path: "/:spaceId/members" },
      user: { participantId: "p-grid-hn" },
      spaceRole: undefined as string | undefined,
    };
    const membership = {
      roleFor: async () => "provider",
      hasAnyMembership: async () => true,
    };
    const guard = new SpaceAccessGuard(membership as never);
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as never;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.spaceRole).toBe("provider");
  });

  it("does not treat a global operator as a member of another space by id", async () => {
    const membership = {
      roleFor: async (spaceId: string) =>
        spaceId === "sh-med" ? "operator" : null,
      hasAnyMembership: async () => true,
    };
    const guard = new SpaceAccessGuard(membership as never);
    await expect(
      guard.canActivate(ctx({ id: "hn-power" }, "/:id")),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
