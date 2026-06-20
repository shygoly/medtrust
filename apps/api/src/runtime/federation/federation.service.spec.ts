import { GMCryptoService } from '../../security/crypto/gm-crypto.service';
import { CaService } from '../participant-identity/ca.service';
import { FederationService } from './federation.service';

describe('FederationService — 跨空间互联 (space-interconnect)', () => {
  let caA: CaService; // our space (sh-med)
  let caB: CaService; // a peer space (bj-med)
  let fed: FederationService;
  let subjectPub: string;

  beforeEach(() => {
    const gm = new GMCryptoService();
    caA = new CaService(gm, 'sh-med');
    caB = new CaService(new GMCryptoService(), 'bj-med');
    fed = new FederationService(caA);
    subjectPub = gm.generateSM2KeyPair().publicKey;
  });

  it('9.2 recognizes a foreign connector cert from a trusted space', () => {
    fed.trustSpace('bj-med', caB.caPublicKey);
    const foreignCert = caB.issue('cn-xiehe', 'p-xiehe', subjectPub); // issued by bj-med CA
    expect(fed.recognizeForeignCert(foreignCert).valid).toBe(true);
  });

  it('9.2 rejects a cert from a space not in the trust list', () => {
    const caC = new CaService(new GMCryptoService(), 'xx-med');
    const cert = caC.issue('cn-x', 'p-x', subjectPub);
    const r = fed.recognizeForeignCert(cert);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('不在联邦信任清单');
  });

  it('9.2 rejects a tampered foreign cert even from a trusted space', () => {
    fed.trustSpace('bj-med', caB.caPublicKey);
    const cert = caB.issue('cn-xiehe', 'p-xiehe', subjectPub);
    expect(fed.recognizeForeignCert({ ...cert, participantId: 'p-attacker' }).valid).toBe(false);
  });

  it('9.3 discovers remote catalog metadata only (no raw data)', () => {
    fed.importRemoteCatalog('bj-med', [
      {
        id: 'r1',
        urn: 'urn:tds:bj-med:r1',
        homeSpace: 'bj-med',
        providerId: 'p-xiehe',
        title: '协和队列',
        classification: '敏感',
        rightsConfirmed: true,
        recordCount: 1000,
      },
    ]);
    const found = fed.discover().find((p) => p.urn === 'urn:tds:bj-med:r1')!;
    expect(found.homeSpace).toBe('bj-med');
    expect(Object.keys(found)).not.toContain('rows');
    expect(Object.keys(found)).not.toContain('data');
  });

  it('9.5 routes a task by URN to the product home space', () => {
    expect(fed.resolveHomeSpace('urn:tds:bj-med:r1')).toBe('bj-med');
    expect(fed.resolveHomeSpace('not-a-urn')).toBeNull();
  });

  it('9.4 relay-plan: relay to a trusted space, reject otherwise', () => {
    // seeded trust includes bj-med
    expect(fed.relayPlan('urn:tds:bj-med:r1').decision).toBe('relay');
    const reject = fed.relayPlan('urn:tds:gz-med:r9');
    expect(reject.decision).toBe('reject');
    expect(reject.reason).toContain('未在联邦信任清单');
    expect(fed.relayPlan('not-a-urn').decision).toBe('reject');
  });
});
