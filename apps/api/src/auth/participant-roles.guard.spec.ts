import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ParticipantRolesGuard } from './participant-roles.guard';

function ctx(user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => null,
    getClass: () => null,
  } as any;
}

describe('ParticipantRolesGuard', () => {
  function guardWith(required: string[] | undefined) {
    const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
    return new ParticipantRolesGuard(reflector);
  }

  it('allows when no roles are required', () => {
    expect(guardWith(undefined).canActivate(ctx({ role: 'consumer' }))).toBe(true);
  });

  it('allows when the user role matches', () => {
    expect(guardWith(['provider']).canActivate(ctx({ role: 'provider' }))).toBe(true);
  });

  it('forbids when the user role does not match', () => {
    expect(() => guardWith(['provider']).canActivate(ctx({ role: 'consumer' }))).toThrow(ForbiddenException);
  });

  it('forbids when there is no role', () => {
    expect(() => guardWith(['provider']).canActivate(ctx({}))).toThrow(ForbiddenException);
  });
});
