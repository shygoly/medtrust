import {
  RwsOrchestratorService,
  aggregateSm3,
} from "../rws-orchestrator.service";

/** True original — captured once before any test spies nest. */
const COMPLETE_ORIG = RwsOrchestratorService.prototype.completeAssignment;

/**
 * Unit/e2e helpers historically called completeAssignment without aggregateHash.
 * Production path (connector ControlPlaneClient) always sends the hash.
 * Always delegates to COMPLETE_ORIG so repeated beforeEach calls cannot nest spies.
 */
export function autoFillAggregateHash(): void {
  const proto = RwsOrchestratorService.prototype;
  const spy = jest.isMockFunction(proto.completeAssignment)
    ? (proto.completeAssignment as unknown as jest.SpyInstance)
    : jest.spyOn(proto, "completeAssignment");

  spy.mockImplementation(async function (
    this: RwsOrchestratorService,
    assignmentId: string,
    providerId: string,
    body: {
      aggregate?: unknown;
      aggregateHash?: string;
      error?: string;
    },
  ) {
    let next = body;
    if (body?.aggregate && body.aggregateHash === undefined) {
      next = { ...body, aggregateHash: aggregateSm3(body.aggregate) };
    }
    return COMPLETE_ORIG.call(this, assignmentId, providerId, next);
  });
}

/** Temporarily use the real completeAssignment (for P1-6 fail-closed assertions). */
export function useRawCompleteAssignment(): void {
  const proto = RwsOrchestratorService.prototype;
  if (jest.isMockFunction(proto.completeAssignment)) {
    (proto.completeAssignment as unknown as jest.SpyInstance).mockRestore();
  }
}
