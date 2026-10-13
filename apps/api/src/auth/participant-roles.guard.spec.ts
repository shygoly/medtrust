import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ParticipantRolesGuard } from "./participant-roles.guard";

function ctx(user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
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
});
