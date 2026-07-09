import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { DEMO_CONSUMER_SM2_KEYS } from './demo-consumer-keys';
import { loraHashFromAdapter, type AdapterState } from './fed-adapter-merge';
import { LoraDeliverableService } from './lora-deliverable.service';
import { verifyLoraDeliverableBundle } from './lora-deliverable-verify';

describe('verifyLoraDeliverableBundle', () => {
  const gm = new GMCryptoService();
  const adapter: AdapterState = {
    'head.lora_A': {
      shape: [2, 2],
      data: Buffer.from(new Float32Array([0.1, 0.2, 0.3, 0.4]).buffer).toString('base64'),
    },
    'head.lora_B': {
      shape: [2, 2],
      data: Buffer.from(new Float32Array([0, 0, 0, 0]).buffer).toString('base64'),
    },
  };

  it('passes full step chain for a sealed deliverable', async () => {
    process.env.LORA_DELIVERABLE_DIR = `/tmp/medtrust-verify-${Date.now()}`;
    const svc = new LoraDeliverableService(gm);
    const hash = loraHashFromAdapter(adapter);
    const record = await svc.sealAndStore({
      taskId: 'verify-demo-1',
      consumerId: 'pharma-hengrui',
      adapter,
      loraDeltaHash: hash,
    });

    const report = verifyLoraDeliverableBundle(
      gm,
      record,
      DEMO_CONSUMER_SM2_KEYS['pharma-hengrui'].privateKey,
      hash,
    );

    expect(report.ok).toBe(true);
    expect(report.computedLoraHash).toBe(hash);
    expect(report.steps.every((s) => s.status !== 'fail')).toBe(true);
    expect(report.steps.find((s) => s.id === 'done')?.status).toBe('ok');
  });

  it('fails when lora hash does not match', async () => {
    process.env.LORA_DELIVERABLE_DIR = `/tmp/medtrust-verify-${Date.now()}-2`;
    const svc = new LoraDeliverableService(gm);
    const record = await svc.sealAndStore({
      taskId: 'verify-demo-2',
      consumerId: 'pharma-hengrui',
      adapter,
      loraDeltaHash: loraHashFromAdapter(adapter),
    });

    const report = verifyLoraDeliverableBundle(
      gm,
      record,
      DEMO_CONSUMER_SM2_KEYS['pharma-hengrui'].privateKey,
      'LORA:deadbeefdeadbeef',
    );

    expect(report.ok).toBe(false);
    expect(report.steps.find((s) => s.id === 'hash_match_task')?.status).toBe('fail');
  });
});
