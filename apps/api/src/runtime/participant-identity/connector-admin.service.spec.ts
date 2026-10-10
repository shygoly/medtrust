import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ConnectorAdminService } from "./connector-admin.service";
import { mockRepo } from "../test-utils/mock-repo";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";

describe("ConnectorAdminService — 连接器注册/注销(6.2)", () => {
  let svc: ConnectorAdminService;
  let certsRepo: ReturnType<typeof mockRepo>;
  let registryRepo: ReturnType<typeof mockRepo>;
  let ca: { issue: jest.Mock; revoke: jest.Mock };
  let gm: { generateSM2KeyPair: jest.Mock };
  // 连接器自持的公钥（未压缩点 04‖x‖y）——注册必须带它。
  let connectorPublicKey: string;

  beforeEach(() => {
    connectorPublicKey = new GMCryptoService().generateSM2KeyPair().publicKey;
    certsRepo = mockRepo();
    registryRepo = mockRepo();
    ca = {
      // Simulate CaService.issue writing to the certificate registry.
      issue: jest
        .fn()
        .mockImplementation(
          async (connectorId: string, participantId: string, pub: string) => {
            const cert = {
              spaceId: "sh-med",
              connectorId,
              participantId,
              subjectPublicKey: pub,
              validUntil: new Date(Date.now() + 86400_000).toISOString(),
              fingerprint: `SM2:${connectorId}`,
              signature: "sig",
            };
            await certsRepo.save(
              certsRepo.create({
                sm2Fingerprint: cert.fingerprint,
                participantId,
                connectorId,
                spaceId: "sh-med",
                validUntil: new Date(),
                revoked: false,
              }),
            );
            return cert;
          },
        ),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    gm = {
      generateSM2KeyPair: jest
        .fn()
        .mockReturnValue({ publicKey: "pub", privateKey: "priv" }),
    };
    svc = new ConnectorAdminService(
      ca as any,
      gm as any,
      certsRepo as any,
      registryRepo as any,
    );
  });

  it("registers a connector: issues a cert and writes the registry", async () => {
    const r = await svc.register({
      connectorId: "conn-hs-1",
      participantId: "demohospa",
      subjectPublicKey: connectorPublicKey,
      capabilities: ["rws-worker"],
    });
    expect(r.connectorId).toBe("conn-hs-1");
    expect(r.certificate.fingerprint).toBe("SM2:conn-hs-1");
    expect(ca.issue).toHaveBeenCalledWith(
      "conn-hs-1",
      "demohospa",
      connectorPublicKey,
    );
    expect(await registryRepo.count()).toBe(1);
    // 参与方密钥自持：平台不生成、也不回传任何私钥。
    expect(gm.generateSM2KeyPair).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty("privateKey");
    expect(JSON.stringify(r)).not.toContain("privateKey");
  });

  it("rejects a duplicate connector id", async () => {
    await svc.register({
      connectorId: "conn-hs-1",
      participantId: "demohospa",
      subjectPublicKey: connectorPublicKey,
    });
    await expect(
      svc.register({
        connectorId: "conn-hs-1",
        participantId: "demohospa",
        subjectPublicKey: connectorPublicKey,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("注册不带公钥即拒（平台不代生成参与方密钥，D-MDOP-3）", async () => {
    await expect(
      svc.register({
        connectorId: "conn-x",
        participantId: "x",
        subjectPublicKey: "",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(gm.generateSM2KeyPair).not.toHaveBeenCalled();
    expect(await registryRepo.count()).toBe(0);
  });

  it("公钥形态非法即拒（不是 SM2 未压缩点）", async () => {
    await expect(
      svc.register({
        connectorId: "conn-x",
        participantId: "x",
        subjectPublicKey: "not-a-real-key",
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("deregisters: revokes the cert and removes the registry row", async () => {
    await svc.register({
      connectorId: "conn-hs-1",
      participantId: "demohospa",
      subjectPublicKey: connectorPublicKey,
    });
    const r = await svc.deregister("conn-hs-1");
    expect(r.deregistered).toBe(true);
    expect(ca.revoke).toHaveBeenCalledWith("SM2:conn-hs-1");
    expect(await registryRepo.count()).toBe(0);
  });

  it("rejects deregistering an unknown connector", async () => {
    await expect(svc.deregister("nope")).rejects.toThrow(NotFoundException);
  });

  it("用调用方提供的公钥签发证书（平台全程不生成密钥）", async () => {
    const r = await svc.register({
      connectorId: "conn-rj-1",
      participantId: "demohospb",
      subjectPublicKey: connectorPublicKey,
    });
    expect(r).not.toHaveProperty("privateKey");
    expect(ca.issue).toHaveBeenCalledWith(
      "conn-rj-1",
      "demohospb",
      connectorPublicKey,
    );
  });

  it("heartbeat persists payload and listRegistry marks offline after threshold (P1-9)", async () => {
    // 阈值放宽到 1s:满载并行跑测试时 50ms 会误判 offline(测试抖动,与实现无关)
    process.env.CONNECTOR_OFFLINE_MS = "1000";
    await svc.register({
      connectorId: "conn-hs-1",
      participantId: "demohospa",
      subjectPublicKey: connectorPublicKey,
    });
    const online = await svc.heartbeat("demohospa", {
      version: "1.2.3",
      taskStatus: { polling: true },
      resources: { heapUsedMb: 64 },
    });
    expect(online.healthStatus).toBe("online");
    expect(online.lastHeartbeat?.version).toBe("1.2.3");
    expect(online.lastHeartbeat?.resources).toEqual({ heapUsedMb: 64 });

    const [row] = await svc.listRegistry();
    expect(row.healthStatus).toBe("online");

    await new Promise((r) => setTimeout(r, 1100));
    const [stale] = await svc.listRegistry();
    expect(stale.healthStatus).toBe("offline");
    expect(stale.lastHeartbeat?.version).toBe("1.2.3");
    delete process.env.CONNECTOR_OFFLINE_MS;
  });
});
