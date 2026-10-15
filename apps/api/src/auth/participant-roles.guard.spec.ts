import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ParticipantRolesGuard } from "./participant-roles.guard";

function ctx(
  user: any,
  headers: Record<string, unknown> = {},
  params: { spaceId?: string; id?: string } = {},
  path = "",
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, headers, params, route: { path } }),
    }),
    getHandler: () => null,
    getClass: () => null,
  } as any;
}

describe("ParticipantRolesGuard", () => {
  function guardWith(required: string[] | undefined) {
    const reflector = {
      getAllAndOverride: () => required,
    } as unknown as Reflector;
    return new ParticipantRolesGuard(reflector);
  }

  it("allows when no roles are required", async () => {
    await expect(
      guardWith(undefined).canActivate(ctx({ role: "consumer" })),
    ).resolves.toBe(true);
  });

  it("allows when the user role matches", async () => {
    await expect(
      guardWith(["provider"]).canActivate(ctx({ role: "provider" })),
    ).resolves.toBe(true);
  });

  it("forbids when the user role does not match", async () => {
    await expect(
      guardWith(["provider"]).canActivate(ctx({ role: "consumer" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("forbids when there is no role", async () => {
    await expect(
      guardWith(["provider"]).canActivate(ctx({})),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("uses the membership role in the token space, not the global role", async () => {
    const membership = {
      roleFor: async () => "provider",
      hasAnyMembership: async () => true,
    };
    const reflector = {
      getAllAndOverride: () => ["operator"],
    } as unknown as Reflector;
    const guard = new ParticipantRolesGuard(reflector, membership as never);
    await expect(
      guard.canActivate(
        ctx({
          role: "operator",
          spaceId: "hn-power",
          participantId: "p-grid-hn",
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("uses the header space role, not the token space role", async () => {
    const membership = {
      roleFor: async (spaceId: string) =>
        spaceId === "hn-power" ? "provider" : "operator",
      hasAnyMembership: async () => true,
    };
    const reflector = {
      getAllAndOverride: () => ["operator"],
    } as unknown as Reflector;
    const guard = new ParticipantRolesGuard(reflector, membership as never);
    await expect(
      guard.canActivate(
        ctx(
          {
            role: "operator",
            spaceId: "sh-med",
            spaces: ["sh-med", "hn-power"],
            participantId: "p-grid-hn",
          },
          { "x-space-id": "hn-power" },
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows the role that belongs to the header space", async () => {
    const membership = {
      roleFor: async (spaceId: string) =>
        spaceId === "hn-power" ? "provider" : "operator",
      hasAnyMembership: async () => true,
    };
    const reflector = {
      getAllAndOverride: () => ["provider"],
    } as unknown as Reflector;
    const guard = new ParticipantRolesGuard(reflector, membership as never);
    await expect(
      guard.canActivate(
        ctx(
          {
            role: "operator",
            spaceId: "sh-med",
            spaces: ["sh-med", "hn-power"],
          },
          { "x-space-id": "hn-power" },
        ),
      ),
    ).resolves.toBe(true);
  });

  it("rejects when the route space and the header space differ", async () => {
    const reflector = {
      getAllAndOverride: () => ["operator"],
    } as unknown as Reflector;
    const guard = new ParticipantRolesGuard(reflector);
    await expect(
      guard.canActivate(
        ctx(
          { role: "operator", spaceId: "sh-med" },
          { "x-space-id": "sh-med" },
          { spaceId: "hn-power" },
          "/:spaceId/members",
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
