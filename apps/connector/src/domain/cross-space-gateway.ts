import { Injectable } from '@nestjs/common';
import { RwsOrchestrator, RwsTaskRequest, OrchestrationResult } from './rws-orchestrator';
import { HospitalNode } from './rws-orchestrator';
import { ContractView } from './contract-view';

// A peer space's local execution capability: its own orchestrator + connectors +
// contracts. run() executes entirely within that space — raw data stays there.
export interface SpaceExecutor {
  spaceId: string;
  run(req: RwsTaskRequest): OrchestrationResult;
}

export function makeSpaceExecutor(
  spaceId: string,
  orchestrator: RwsOrchestrator,
  nodes: HospitalNode[],
  contracts: Map<string, ContractView>,
): SpaceExecutor {
  return { spaceId, run: (req) => orchestrator.run(req, nodes, contracts) };
}

export interface CrossSpaceResult {
  homeSpace: string;
  result: OrchestrationResult; // only the aggregate/attestation/settlement
  rawRowsCrossed: 0; // invariant: raw data never crosses spaces
}

// 互通网关 + 跨空间任务执行(space-interconnect 9.4/9.5).
//
// A consumer in one space references a data product by its global URN. The
// gateway resolves the product's home space, verifies the space is mutually
// trusted (handshake), and RELAYS the task to that space — where it executes
// locally (PEP→TEE→output gate). Only the aggregate (or ciphertext) comes back;
// raw rows never leave the source space.
@Injectable()
export class CrossSpaceGateway {
  private readonly spaces = new Map<string, SpaceExecutor>();
  private readonly trusted = new Set<string>();

  registerSpace(executor: SpaceExecutor): void {
    this.spaces.set(executor.spaceId, executor);
  }

  trustSpace(spaceId: string): void {
    this.trusted.add(spaceId);
  }

  // urn:tds:<spaceId>:<productId>
  resolveHomeSpace(urn: string): string | null {
    const m = /^urn:tds:([^:]+):/.exec(urn);
    return m ? m[1] : null;
  }

  runCrossSpace(req: RwsTaskRequest, productUrn: string): CrossSpaceResult {
    const homeSpace = this.resolveHomeSpace(productUrn);
    if (!homeSpace) throw new Error(`非法数据产品 URN: ${productUrn}`);
    // 9.4 — handshake: only relay to a mutually-trusted, reachable space
    if (!this.trusted.has(homeSpace)) throw new Error(`空间 ${homeSpace} 未互信,不能跨空间下发`);
    const executor = this.spaces.get(homeSpace);
    if (!executor) throw new Error(`空间 ${homeSpace} 未接入网关`);
    // 9.5 — execute in the home space; data stays at the source connectors
    const result = executor.run(req);
    return { homeSpace, result, rawRowsCrossed: 0 };
  }
}
