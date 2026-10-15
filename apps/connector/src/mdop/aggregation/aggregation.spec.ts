import { generateSm2KeyPair, MdopError } from '@medtrust/mdop';
import { MdopStageExecutor } from '../mdop-executor';
import { contributionDigest, fedAvg, openOwnShare, sealContribution } from './ciphertext';
import { httpAggregateClient, type AggregatePlatformClient } from './channel';
import { createSecureAggregateHandler } from './handler';

const SM3 = 'ab'.repeat(32);

function memoryPlatform(): AggregatePlatformClient & {
  put(ciphertext: string): string;
} {
  const blobs = new Map<string, { ciphertext: string; digest: string }>();
  let seq = 0;
  return {
    async upload(body) {
      const ref = `blob://c${++seq}`;
      blobs.set(ref, { ciphertext: body.ciphertext, digest: body.digest });
      return { contributionRef: ref };
    },
    async download(contributionRef) {
      const hit = blobs.get(contributionRef);
      if (!hit) throw new MdopError('E_RUNTIME', {}, '密文不存在');
      return hit;
    },
    put(ciphertext) {
      const ref = `blob://c${++seq}`;
      blobs.set(ref, { ciphertext, digest: contributionDigest(ciphertext) });
      return ref;
    },
  };
}

const manifest = {
  apiVersion: 'mdop/v0.3',
  kind: 'secure_aggregate',
  id: 'merge.fedavg-secure',
  version: '1.0.0',
  category: 'aggregation',
  digest: `component:fedavg-secure@1.0.0`,
  publisher: 'urn:tds:space-x:participant:platform',
  inputs: [{ name: 'local_contribution', schema: 'mdop.aggregate/1.0', accept_labels: ['C1'] }],
  outputs: [{ name: 'aggregated', schema: 'mdop.aggregate/1.0', label_rule: 'C3' }],
  params: {},
  environments: ['native'],
  security: { network: 'relay' },
  component: 'aggregator@1.0.0',
  aggregation: { encryption: 'per_recipient_pubkey', party_closure: 'compile_time' },
};

describe('节点侧安全聚合', () => {
  const alice = generateSm2KeyPair();
  const bob = generateSm2KeyPair();
  const parties = [
    { id: 'node-a', publicKey: alice.publicKey },
    { id: 'node-b', publicKey: bob.publicKey },
  ];
  const updateA = { n: 1, weights: [0, 10] };
  const updateB = { n: 3, weights: [4, 0] };

  it('各方公钥加密后，只有对应私钥能解开自己的份额', () => {
    const blob = sealContribution(updateA, parties);
    expect(Buffer.from(blob, 'base64').toString('utf8')).not.toContain('"weights"');
    expect(openOwnShare(blob, 'node-a', alice.privateKey)).toEqual(updateA);
    expect(openOwnShare(blob, 'node-b', bob.privateKey)).toEqual(updateA);
    expect(() => openOwnShare(blob, 'node-a', bob.privateKey)).toThrow(/解密失败/);
  });

  it('两方贡献按样本量加权聚合成 C3', async () => {
    const platform = memoryPlatform();
    const foreign = platform.put(sealContribution(updateB, parties));
    const audit: string[] = [];
    const handler = createSecureAggregateHandler({
      selfId: 'node-a',
      privateKey: alice.privateKey,
      publicKey: alice.publicKey,
      parties,
      client: platform,
      audit: (line) => audit.push(line),
    });
    const executor = new MdopStageExecutor();
    executor.registerSecureAggregate(handler);
    const output = await executor.execute(
      {
        jobId: 'job-1',
        attempt: 1,
        inputs: new Map([['local', updateA]]),
        stage: {
          id: 'agg-1',
          node: 'node-a',
          op: 'merge.fedavg-secure@1.0.0',
          op_digest: `sm3:${SM3}`,
          params: { contribution_refs: [foreign] },
          inputs: [],
          input_labels: ['C1'],
          output_label: 'C3',
          output_schema: 'mdop.aggregate/1.0',
        },
      },
      manifest,
    );
    expect(output.label).toBe('C3');
    expect(output.payload).toEqual(fedAvg([updateB, updateA]));
    expect(output.payload).toEqual({ n: 4, weights: [3, 2.5] });
    expect(audit).toEqual([]);
  });

  it('解密失败拒绝并记审计，不产出部分结果', async () => {
    const platform = memoryPlatform();
    const broken = Buffer.from(
      JSON.stringify({ shares: [{ recipient: 'node-a', ciphertext: '00' }] }),
      'utf8',
    ).toString('base64');
    const audit: string[] = [];
    const handler = createSecureAggregateHandler({
      selfId: 'node-a',
      privateKey: alice.privateKey,
      publicKey: alice.publicKey,
      parties,
      client: platform,
      audit: (line) => audit.push(line),
    });
    await expect(
      handler({
        jobId: 'job-1',
        attempt: 1,
        inputs: new Map([['local', updateA]]),
        stage: {
          id: 'agg-1',
          node: 'node-a',
          op: 'merge.fedavg-secure@1.0.0',
          op_digest: `sm3:${SM3}`,
          params: { contribution_refs: [platform.put(broken)] },
          inputs: [],
          input_labels: ['C1'],
          output_label: 'C3',
          output_schema: 'mdop.aggregate/1.0',
        },
      }),
    ).rejects.toThrow(/解密失败/);
    expect(audit).toEqual(['job=job-1 stage=agg-1 拒绝：E_RUNTIME: 解密失败']);
  });

  it('未注册 secure_aggregate 时拒绝执行', async () => {
    const executor = new MdopStageExecutor();
    await expect(
      executor.execute(
        {
          jobId: 'job-1',
          attempt: 1,
          inputs: new Map(),
          stage: {
            id: 'agg-1',
            node: 'node-a',
            op: 'merge.fedavg-secure@1.0.0',
            op_digest: `sm3:${SM3}`,
            params: {},
            inputs: [],
            input_labels: ['C1'],
            output_label: 'C3',
            output_schema: 'mdop.aggregate/1.0',
          },
        },
        manifest,
      ),
    ).rejects.toThrow(/未注册 secure_aggregate/);
  });

  it('上传和下载走平台聚合端点', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return {
        ok: true,
        json: async () =>
          String(url).includes('/contributions/')
            ? { ciphertext: 'YQ==', digest: 'sm3:aa' }
            : { contributionRef: 'blob://1' },
      };
    }) as typeof fetch;
    const client = httpAggregateClient('http://platform/api/v1/', fetchImpl);
    await client.upload({
      jobId: 'job-1',
      stageId: 'agg-1',
      contributorId: 'node-a',
      ciphertext: 'YQ==',
      digest: 'sm3:aa',
      partialSignature: 'sig',
    });
    await client.download('blob://1');
    expect(calls).toEqual([
      'POST http://platform/api/v1/mdop/aggregate/contributions',
      'GET http://platform/api/v1/mdop/aggregate/contributions/1',
    ]);
  });
});
