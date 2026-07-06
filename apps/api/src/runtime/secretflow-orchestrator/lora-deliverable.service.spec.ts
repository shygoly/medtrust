import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { LoraDeliverableService } from './lora-deliverable.service';
import { DEMO_CONSUMER_SM2_KEYS } from './demo-consumer-keys';
import { loraHashFromAdapter, type AdapterState } from './fed-adapter-merge';

describe('LoraDeliverableService', () => {
  let svc: LoraDeliverableService;

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

  beforeEach(() => {
    process.env.LORA_DELIVERABLE_DIR = `/tmp/medtrust-deliverables-${Date.now()}-${Math.random()}`;
    svc = new LoraDeliverableService(new GMCryptoService());
  });

  it('seals adapter with ENC ref and round-trips decrypt for demo consumer', async () => {
    const hash = loraHashFromAdapter(adapter);
    const record = await svc.sealAndStore({
      taskId: 'fed-demo-1',
      consumerId: 'pharma-hengrui',
      adapter,
      loraDeltaHash: hash,
    });

    expect(record.encryptedDeltaRef).toMatch(/^ENC:[0-9a-f]{16}$/);
    expect(record.loraDeltaHash).toBe(hash);
    expect(record.encryptedData).not.toContain('head.lora_A');

    const restored = svc.decryptForDemo(record, DEMO_CONSUMER_SM2_KEYS['pharma-hengrui'].privateKey);
    expect(restored['head.lora_A'].data).toBe(adapter['head.lora_A'].data);
  });
});
