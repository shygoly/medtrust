import { MdopError, type StageInput, type SystemHandler } from '@medtrust/mdop';
import {
  downloadContributions,
  uploadLocalContribution,
  type AggregatePlatformClient,
} from './channel';
import { fedAvg, type WeightUpdate } from './ciphertext';

export interface SecureAggregateDeps {
  selfId: string;
  privateKey: string;
  publicKey: string;
  parties: readonly { id: string; publicKey: string }[];
  client: AggregatePlatformClient;
  audit: (line: string) => void;
}

/** 节点侧 `secure_aggregate`：上传本方密文，下载各方份额，样本数加权后产出 C3。 */
export function createSecureAggregateHandler(deps: SecureAggregateDeps): SystemHandler {
  return async (input: StageInput) => {
    const update = localUpdate(input);
    const refs = contributionRefs(input);
    try {
      const ownRef = await uploadLocalContribution(deps.client, {
        jobId: input.jobId,
        stageId: input.stage.id,
        selfId: deps.selfId,
        privateKey: deps.privateKey,
        publicKey: deps.publicKey,
        parties: deps.parties,
        update,
      });
      const allRefs = [...new Set([...refs, ownRef])];
      const updates = await downloadContributions(deps.client, allRefs, deps.selfId, deps.privateKey);
      const aggregated = fedAvg(updates);
      return {
        label: 'C3' as const,
        schema: input.stage.output_schema,
        payload: { n: aggregated.n, weights: aggregated.weights },
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : '聚合失败';
      deps.audit(`job=${input.jobId} stage=${input.stage.id} 拒绝：${reason}`);
      if (err instanceof MdopError) throw err;
      throw new MdopError('E_RUNTIME', {}, '聚合失败');
    }
  };
}

function localUpdate(input: StageInput): WeightUpdate {
  for (const payload of input.inputs.values()) {
    if (typeof payload.n === 'number' && Array.isArray(payload.weights))
      return { n: payload.n, weights: payload.weights as number[] };
  }
  throw new MdopError('E_RUNTIME', {}, '本节点没有可上传的本地贡献');
}

function contributionRefs(input: StageInput): string[] {
  const raw = input.stage.params.contribution_refs;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}
