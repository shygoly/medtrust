import { GMCryptoService } from '../security/crypto/gm-crypto.service';
import { CaService } from './ca.service';

describe('CaService — SM2 证书签发/校验/吊销', () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let subjectPub: string;

  beforeEach(() => {
    gm = new GMCryptoService();
    ca = new CaService(gm);
    subjectPub = gm.generateSM2KeyPair().publicKey;
  });

  it('issued certificate verifies as valid', () => {
    const cert = ca.issue('cn-huashan', 'p-huashan', subjectPub);
    expect(ca.verify(cert).valid).toBe(true);
  });

  it('rejects a tampered certificate (signature no longer matches payload)', () => {
    const cert = ca.issue('cn-huashan', 'p-huashan', subjectPub);
    const forged = { ...cert, connectorId: 'cn-attacker' };
    const r = ca.verify(forged);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('签名');
  });

  it('rejects a revoked certificate (2.6)', () => {
    const cert = ca.issue('cn-huashan', 'p-huashan', subjectPub);
    ca.revoke(cert.fingerprint);
    const r = ca.verify(cert);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('吊销');
  });

  it('rejects an expired certificate', () => {
    const cert = ca.issue('cn-huashan', 'p-huashan', subjectPub, -1);
    const r = ca.verify(cert);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('过期');
  });
});
