import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "./ca.service";
import {
  ParticipantRegistryService,
  AdmissionDeniedError,
} from "./participant-registry.service";
import { mockRepo } from "../test-utils/mock-repo";

describe("ParticipantRegistryService — 准入与授权门禁", () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let reg: ParticipantRegistryService;
  let subjectPub: string;

  beforeEach(async () => {
    gm = new GMCryptoService();
    ca = new CaService(gm, mockRepo(), mockRepo());
    await ca.onModuleInit();
    reg = new ParticipantRegistryService(ca, mockRepo());
    subjectPub = gm.generateSM2KeyPair().publicKey;
  });

  it("2.2 accepts a CA-issued connector, rejects an untrusted one", async () => {
    const good = await ca.issue("cn-demohospa", "p-demohospa", subjectPub);
    await expect(reg.registerConnector(good)).resolves.toBeUndefined();

    const forged = { ...good, signature: "deadbeef" };
    await expect(reg.registerConnector(forged)).rejects.toThrow(
      AdmissionDeniedError,
    );
  });

  it("2.4 rejects admission when data resource is not verified (dual auth)", async () => {
    await expect(
      reg.admit({
        org: "示范甲医院",
        subjectVerified: true,
        dataVerified: false,
      }),
    ).rejects.toThrow(/数据资源未认证/);
    await expect(
      reg.admit({
        org: "示范甲医院",
        subjectVerified: true,
        dataVerified: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("2.5 rejects authorization of an unconfirmed or unclassified dataset", () => {
    expect(() =>
      reg.authorizeDataset({
        title: "A",
        rightsConfirmed: false,
        classification: "敏感",
      }),
    ).toThrow(/未确权/);
    expect(() =>
      reg.authorizeDataset({ title: "A", rightsConfirmed: true }),
    ).toThrow(/未分级分类/);
    expect(() =>
      reg.authorizeDataset({
        title: "A",
        rightsConfirmed: true,
        classification: "敏感",
      }),
    ).not.toThrow();
  });

  it("2.6 blocks task interaction after the certificate is revoked", async () => {
    const cert = await ca.issue("cn-demohospa", "p-demohospa", subjectPub);
    await expect(reg.assertCanInteract(cert)).resolves.toBeUndefined();
    await ca.revoke(cert.fingerprint);
    await expect(reg.assertCanInteract(cert)).rejects.toThrow(
      AdmissionDeniedError,
    );
  });
});
