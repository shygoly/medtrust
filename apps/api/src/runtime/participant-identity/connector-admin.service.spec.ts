import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConnectorAdminService } from "./connector-admin.service";
import { mockRepo } from "../test-utils/mock-repo";

describe("ConnectorAdminService — 连接器注册/注销(6.2)", () => {
  let svc: ConnectorAdminService;
  let certsRepo: ReturnType<typeof mockRepo>;
  let registryRepo: ReturnType<typeof mockRepo>;
  let ca: { issue: jest.Mock; revoke: jest.Mock };
  let gm: { generateSM2KeyPair: jest.Mock };

  beforeEach(() => {
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
      participantId: "huashan",
      capabilities: ["rws-worker"],
    });
    expect(r.connectorId).toBe("conn-hs-1");
    expect(r.certificate.fingerprint).toBe("SM2:conn-hs-1");
    expect(r.privateKey).toBe("priv");
    expect(ca.issue).toHaveBeenCalledWith("conn-hs-1", "huashan", "pub");
    expect(await registryRepo.count()).toBe(1);
  });

  it("rejects a duplicate connector id", async () => {
    await svc.register({ connectorId: "conn-hs-1", participantId: "huashan" });
    await expect(
      svc.register({ connectorId: "conn-hs-1", participantId: "huashan" }),
    ).rejects.toThrow(ConflictException);
  });

  it("deregisters: revokes the cert and removes the registry row", async () => {
    await svc.register({ connectorId: "conn-hs-1", participantId: "huashan" });
    const r = await svc.deregister("conn-hs-1");
    expect(r.deregistered).toBe(true);
    expect(ca.revoke).toHaveBeenCalledWith("SM2:conn-hs-1");
    expect(await registryRepo.count()).toBe(0);
  });

  it("rejects deregistering an unknown connector", async () => {
    await expect(svc.deregister("nope")).rejects.toThrow(NotFoundException);
  });

  it("reuses a caller-provided subject public key (no generated private key)", async () => {
    const r = await svc.register({
      connectorId: "conn-rj-1",
      participantId: "ruijin",
      subjectPublicKey: "connector-owned-pub",
    });
    expect(r.privateKey).toBeUndefined();
    expect(ca.issue).toHaveBeenCalledWith(
      "conn-rj-1",
      "ruijin",
      "connector-owned-pub",
    );
  });

  it("heartbeat persists payload and listRegistry marks offline after threshold (P1-9)", async () => {
    // 阈值放宽到 1s:满载并行跑测试时 50ms 会误判 offline(测试抖动,与实现无关)
    process.env.CONNECTOR_OFFLINE_MS = "1000";
    await svc.register({ connectorId: "conn-hs-1", participantId: "huashan" });
    const online = await svc.heartbeat("huashan", {
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
