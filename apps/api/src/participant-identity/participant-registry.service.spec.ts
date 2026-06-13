import { GMCryptoService } from '../security/crypto/gm-crypto.service';
import { CaService } from './ca.service';
import { ParticipantRegistryService, AdmissionDeniedError } from './participant-registry.service';

describe('ParticipantRegistryService — 准入与授权门禁', () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let reg: ParticipantRegistryService;
  let subjectPub: string;

  beforeEach(() => {
    gm = new GMCryptoService();
    ca = new CaService(gm);
    reg = new ParticipantRegistryService(ca);
    subjectPub = gm.generateSM2KeyPair().publicKey;
  });

  it('2.2 accepts a CA-issued connector, rejects an untrusted one', () => {
    const good = ca.issue('cn-huashan', 'p-huashan', subjectPub);
    expect(() => reg.registerConnector(good)).not.toThrow();

    const forged = { ...good, signature: 'deadbeef' };
    expect(() => reg.registerConnector(forged)).toThrow(AdmissionDeniedError);
  });

  it('2.4 rejects admission when data resource is not verified (dual auth)', () => {
    expect(() => reg.admit({ org: '华山医院', subjectVerified: true, dataVerified: false })).toThrow(
      /数据资源未认证/,
    );
    expect(() => reg.admit({ org: '华山医院', subjectVerified: true, dataVerified: true })).not.toThrow();
  });

  it('2.5 rejects authorization of an unconfirmed or unclassified dataset', () => {
    expect(() => reg.authorizeDataset({ title: 'A', rightsConfirmed: false, classification: '敏感' })).toThrow(
      /未确权/,
    );
    expect(() => reg.authorizeDataset({ title: 'A', rightsConfirmed: true })).toThrow(/未分级分类/);
    expect(() =>
      reg.authorizeDataset({ title: 'A', rightsConfirmed: true, classification: '敏感' }),
    ).not.toThrow();
  });

  it('2.6 blocks task interaction after the certificate is revoked', () => {
    const cert = ca.issue('cn-huashan', 'p-huashan', subjectPub);
    expect(() => reg.assertCanInteract(cert)).not.toThrow();
    ca.revoke(cert.fingerprint);
    expect(() => reg.assertCanInteract(cert)).toThrow(AdmissionDeniedError);
  });
});
