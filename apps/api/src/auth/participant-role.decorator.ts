import { SetMetadata } from '@nestjs/common';
import { ParticipantRole } from '@medtrust/database';

export const PARTICIPANT_ROLES_KEY = 'participantRoles';

// Route-level coarse authz: restrict an endpoint to one or more participant
// roles. Fine-grained "who may use which data" stays in digital contracts (PEP).
// Usage: @ParticipantRole('provider')
export const ParticipantRole2 = (...roles: ParticipantRole[]) =>
  SetMetadata(PARTICIPANT_ROLES_KEY, roles);

// Friendly alias (the type and the decorator share the name "ParticipantRole",
// so the decorator is exported under a clear name).
export { ParticipantRole2 as ParticipantRoles };
