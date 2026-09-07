import { createHash } from 'crypto';
import { sm3Fingerprint } from '../sm3';
import { SecretFlowTaskSpec } from './secretflow-task-spec';
import { assertSafeSecretFlowRunResult } from './secretflow-output-guard';
import { SecretFlowRunResult } from './secretflow-run-result';
import {
  SecretFlowEnvironmentStatus,
  SecretFlowPreparedTask,
  SecretFlowRuntimeAdapter,
  SecretFlowRuntimeContext,
} from './secretflow-runtime-adapter';

function digest(prefix: string, input: string): string {
  return `${prefix}:${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}

export function canonicalSpecJson(spec: SecretFlowTaskSpec): string {
  return JSON.stringify(spec);
}

export function hashSecretFlowSpec(taskId: string, spec: SecretFlowTaskSpec): string {
  // 真国密 SM3(不以 sha256 冒充);digest('LORA'/'ENC') 仅为内部哈希标签。
  return sm3Fingerprint(`${taskId}:${canonicalSpecJson(spec)}`);
}

export class MockSecretFlowAdapter implements SecretFlowRuntimeAdapter {
  validateEnvironment(): SecretFlowEnvironmentStatus {
    return {
      ready: true,
      runtime: 'mock',
      details: 'mock-secretflow-runtime',
    };
  }

  prepare(context: SecretFlowRuntimeContext): SecretFlowPreparedTask {
    const specHash = hashSecretFlowSpec(context.taskId, context.spec);
    return {
      taskId: context.taskId,
      specHash,
      partyCount: context.spec.parties.length,
      modalityTypes: context.spec.modalities.map((modality) => modality.type),
      preparedAt: new Date(0).toISOString(),
    };
  }

  run(prepared: SecretFlowPreparedTask, spec: SecretFlowTaskSpec): SecretFlowRunResult {
    const loraDeltaHash = digest('LORA', prepared.specHash);
    const encryptedDeltaRef = digest('ENC', `${prepared.specHash}:delta`);
    const reportHash = digest('ATT', `${prepared.specHash}:report`);

    return assertSafeSecretFlowRunResult({
      taskId: prepared.taskId,
      roundsCompleted: 1,
      metrics: {
        trainLoss: Number(`0.${prepared.specHash.slice(-4)}`) || 0.1234,
        valLoss: Number(`0.${prepared.specHash.slice(-3)}`) || 0.2345,
        partyCount: prepared.partyCount,
      },
      loraDeltaHash,
      encryptedDeltaRef,
      attestation: {
        reportHash,
        runtime: 'mock',
        generatedAt: new Date(0).toISOString(),
        specHash: prepared.specHash,
      },
      privacySummary: {
        teeRequired: spec.privacy.teeRequired,
        heuEnabled: spec.privacy.heuEnabled,
        dpSgdEnabled: Boolean(spec.privacy.dpSgd),
        safeOutputOnly: true,
      },
      modelCard: {
        modelType: spec.llmBackbone.modelType,
        modelNameOrPath: spec.llmBackbone.modelNameOrPath,
        peftType: spec.peftStrategy.type,
      },
    });
  }

  cleanup(_prepared: SecretFlowPreparedTask): void {
    // Mock runtime has no external resources to release.
  }
}
