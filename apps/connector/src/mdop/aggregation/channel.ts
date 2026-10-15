import { MdopError, sm2Sign } from '@medtrust/mdop';
import {
  contributionDigest,
  openOwnShare,
  sealContribution,
  type WeightUpdate,
} from './ciphertext';

export interface AggregatePlatformClient {
  upload(body: {
    jobId: string;
    stageId: string;
    contributorId: string;
    ciphertext: string;
    digest: string;
    partialSignature: string;
  }): Promise<{ contributionRef: string }>;
  download(contributionRef: string): Promise<{ ciphertext: string; digest: string }>;
}

/** 对 `POST /api/v1/mdop/aggregate/contributions` 的出站客户端。 */
export function httpAggregateClient(apiBase: string, fetchImpl: typeof fetch = fetch): AggregatePlatformClient {
  const root = apiBase.replace(/\/$/, '');
  return {
    async upload(body) {
      const response = await fetchImpl(`${root}/mdop/aggregate/contributions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new MdopError('E_RUNTIME', {}, '密文上传被拒绝');
      return (await response.json()) as { contributionRef: string };
    },
    async download(contributionRef) {
      const id = contributionRef.replace(/^blob:\/\//, '');
      const response = await fetchImpl(`${root}/mdop/aggregate/contributions/${id}`);
      if (!response.ok) throw new MdopError('E_RUNTIME', {}, '密文下载失败');
      return (await response.json()) as { ciphertext: string; digest: string };
    },
  };
}

export async function uploadLocalContribution(
  client: AggregatePlatformClient,
  input: {
    jobId: string;
    stageId: string;
    selfId: string;
    privateKey: string;
    publicKey: string;
    parties: readonly { id: string; publicKey: string }[];
    update: WeightUpdate;
  },
): Promise<string> {
  const ciphertext = sealContribution(input.update, input.parties);
  const digest = contributionDigest(ciphertext);
  const partialSignature = sm2Sign(`${input.stageId}:${digest}`, input.privateKey, {
    publicKey: input.publicKey,
  });
  const uploaded = await client.upload({
    jobId: input.jobId,
    stageId: input.stageId,
    contributorId: input.selfId,
    ciphertext,
    digest,
    partialSignature,
  });
  return uploaded.contributionRef;
}

export async function downloadContributions(
  client: AggregatePlatformClient,
  refs: readonly string[],
  selfId: string,
  privateKey: string,
): Promise<WeightUpdate[]> {
  const updates: WeightUpdate[] = [];
  for (const ref of refs) {
    const blob = await client.download(ref);
    if (contributionDigest(blob.ciphertext) !== blob.digest)
      throw new MdopError('E_RUNTIME', {}, '下载的密文摘要不符');
    updates.push(openOwnShare(blob.ciphertext, selfId, privateKey));
  }
  return updates;
}
