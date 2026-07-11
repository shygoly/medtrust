import { ForbiddenException, Injectable } from "@nestjs/common";
import { DigitalContract } from "@medtrust/database";
import { ContractService } from "../digital-contract/contract.service";
import { SecretFlowTaskSpec } from "../../compute-task/dto/secretflow-task-spec";

export interface AdmittedContracts {
  consumerId: string;
  contracts: DigitalContract[];
  contractHashes: string[];
}

export interface AdmissionOptions {
  contractIds?: string[];
  purpose?: string;
}

/**
 * Control-plane PEP admission for SecretFlow tasks.
 *
 * Fail-closed (mirrors the connector PEP): a task is dispatched only if every
 * provider party is covered by an active, matching, unexpired digital contract
 * from the consumer. No contract → no dispatch.
 */
@Injectable()
export class SecretFlowAdmissionService {
  constructor(private readonly contracts: ContractService) {}

  async admit(
    spec: SecretFlowTaskSpec,
    opts: AdmissionOptions = {},
  ): Promise<AdmittedContracts> {
    const consumer = spec.parties.find((p) => p.role === "consumer");
    if (!consumer) {
      throw new ForbiddenException("SecretFlow task requires a consumer party");
    }
    const providers = spec.parties.filter((p) => p.role === "provider");
    if (providers.length === 0) {
      throw new ForbiddenException(
        "SecretFlow task requires at least one provider party",
      );
    }

    const referenced = (
      await Promise.all(
        (opts.contractIds ?? []).map((id) => this.contracts.get(id)),
      )
    ).filter((c): c is DigitalContract => Boolean(c));

    const matched: DigitalContract[] = [];
    for (const provider of providers) {
      const contract = referenced.find(
        (c) =>
          this.contracts.effectiveStatus(c) === "active" &&
          c.consumerId === consumer.participantId &&
          c.providerId === provider.participantId &&
          (!opts.purpose || c.purpose === opts.purpose),
      );
      if (!contract) {
        const why = opts.purpose ? ` for purpose "${opts.purpose}"` : "";
        throw new ForbiddenException(
          `No active digital contract authorizing consumer ${consumer.participantId} ` +
            `to use provider ${provider.participantId}'s data${why}`,
        );
      }
      matched.push(contract);
    }

    return {
      consumerId: consumer.participantId,
      contracts: matched,
      contractHashes: matched
        .map((c) => c.hash)
        .filter((h): h is string => Boolean(h)),
    };
  }
}
