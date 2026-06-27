import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { CaService } from './ca.service';
import { mockRepo } from '../test-utils/mock-repo';

describe('CaService — SM2 证书签发/校验/吊销', () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let subjectPub: string;

  beforeEach(async () => {
    gm = new GMCryptoService();
    ca = new CaService(gm, mockRepo(), mockRepo());
    await ca.onModuleInit(); // load/generate + persist the CA root keypair
    subjectPub = gm.generateSM2KeyPair().publicKey;
  });

  it('issued certificate verifies as valid', async () => {
    const cert = await ca.issue('cn-huashan', 'p-huashan', subjectPub);
    expect((await ca.verify(cert)).valid).toBe(true);
  });

  it('rejects a tampered certificate (signature no longer matches payload)', async () => {
    const cert = await ca.issue('cn-huashan', 'p-huashan', subjectPub);
    const forged = { ...cert, connectorId: 'cn-attacker' };
    const r = await ca.verify(forged);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('签名');
  });

  it('rejects a revoked certificate (2.6)', async () => {
    const cert = await ca.issue('cn-huashan', 'p-huashan', subjectPub);
    await ca.revoke(cert.fingerprint);
    const r = await ca.verify(cert);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('吊销');
  });

  it('rejects an expired certificate', async () => {
    const cert = await ca.issue('cn-huashan', 'p-huashan', subjectPub, -1);
    const r = await ca.verify(cert);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('过期');
  });
});
