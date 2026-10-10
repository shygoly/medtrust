import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import { FederationService } from "./federation.service";
import { mockRepo } from "../test-utils/mock-repo";

describe("FederationService — 跨空间互联 (space-interconnect)", () => {
  let caA: CaService; // our space (sh-med)
  let caB: CaService; // a peer space (bj-med)
  let fed: FederationService;
  let subjectPub: string;

  beforeEach(async () => {
    const gm = new GMCryptoService();
    caA = new CaService(gm, mockRepo(), mockRepo(), "sh-med");
    caB = new CaService(
      new GMCryptoService(),
      mockRepo(),
      mockRepo(),
      "bj-med",
    );
    await caA.onModuleInit();
    await caB.onModuleInit();
    fed = new FederationService(caA, mockRepo(), mockRepo());
    await fed.onModuleInit(); // seeds trust('bj-med') + a remote product
    subjectPub = gm.generateSM2KeyPair().publicKey;
  });

  it("9.2 recognizes a foreign connector cert from a trusted space", async () => {
    await fed.trustSpace("bj-med", caB.caPublicKey);
    const foreignCert = await caB.issue("cn-demohospd", "p-demohospd", subjectPub); // issued by bj-med CA
    expect((await fed.recognizeForeignCert(foreignCert)).valid).toBe(true);
  });

  it("9.2 rejects a cert from a space not in the trust list", async () => {
    const caC = new CaService(
      new GMCryptoService(),
      mockRepo(),
      mockRepo(),
      "xx-med",
    );
    await caC.onModuleInit();
    const cert = await caC.issue("cn-x", "p-x", subjectPub);
    const r = await fed.recognizeForeignCert(cert);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("不在联邦信任清单");
  });

  it("9.2 rejects a tampered foreign cert even from a trusted space", async () => {
    await fed.trustSpace("bj-med", caB.caPublicKey);
    const cert = await caB.issue("cn-demohospd", "p-demohospd", subjectPub);
    expect(
      (await fed.recognizeForeignCert({ ...cert, participantId: "p-attacker" }))
        .valid,
    ).toBe(false);
  });

  it("9.3 discovers remote catalog metadata only (no raw data)", async () => {
    await fed.importRemoteCatalog("bj-med", [
      {
        id: "r1",
        urn: "urn:tds:bj-med:r1",
        homeSpace: "bj-med",
        providerId: "p-demohospd",
        title: "示范丁队列",
        classification: "敏感",
        rightsConfirmed: true,
        recordCount: 1000,
      },
    ]);
    const found = (await fed.discover()).find(
      (p) => p.urn === "urn:tds:bj-med:r1",
    )!;
    expect(found.homeSpace).toBe("bj-med");
    expect(Object.keys(found)).not.toContain("rows");
    expect(Object.keys(found)).not.toContain("data");
  });

  it("9.5 routes a task by URN to the product home space", () => {
    expect(fed.resolveHomeSpace("urn:tds:bj-med:r1")).toBe("bj-med");
    expect(fed.resolveHomeSpace("not-a-urn")).toBeNull();
  });

  it("9.4 relay-plan: relay to a trusted space, reject otherwise", async () => {
    // seeded trust includes bj-med
    expect((await fed.relayPlan("urn:tds:bj-med:r1")).decision).toBe("relay");
    const reject = await fed.relayPlan("urn:tds:gz-med:r9");
    expect(reject.decision).toBe("reject");
    expect(reject.reason).toContain("未在联邦信任清单");
    expect((await fed.relayPlan("not-a-urn")).decision).toBe("reject");
  });
});
