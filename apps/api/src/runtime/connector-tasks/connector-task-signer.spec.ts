import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaKeypair, Certificate } from "@medtrust/database";
import {
  CaService,
  taskSignaturePayload,
} from "../participant-identity/ca.service";
import { mockRepo } from "../test-utils/mock-repo";
import {
  ConnectorTaskSigner,
  connectorTaskCanonical,
} from "./connector-task-signer.service";
import { sm2 } from "sm-crypto";

async function build() {
  const gm = new GMCryptoService();
  const ca = new CaService(
    gm,
    mockRepo<CaKeypair>() as never,
    mockRepo<Certificate>() as never,
  );
  await ca.onModuleInit();
  return { gm, ca, signer: new ConnectorTaskSigner(ca, gm) };
}

describe("ConnectorTaskSigner — 下发任务平台签名 (D4)", () => {
  it("规范化口径与连接器侧一致(字面量对拍)", () => {
    // 同一个夹具在连接器侧 connector-task-signature.spec.ts 断言同一对值。
    expect(
      connectorTaskCanonical({
        participantId: "p-huashan",
        taskKind: "rws",
        taskId: "a-1",
        issuedAt: "2026-09-18T00:00:00.000Z",
        payload: { assignmentId: "a-1", taskId: "t-1" },
      }),
    ).toBe(
      '{"issuedAt":"2026-09-18T00:00:00.000Z","participantId":"p-huashan","payload":{"assignmentId":"a-1","taskId":"t-1"},"taskId":"a-1","taskKind":"rws"}',
    );
    expect(
      new GMCryptoService().sm3Hash(
        connectorTaskCanonical({
          participantId: "p-huashan",
          taskKind: "rws",
          taskId: "a-1",
          issuedAt: "2026-09-18T00:00:00.000Z",
          payload: { assignmentId: "a-1", taskId: "t-1" },
        }),
      ),
    ).toBe("94d53f61711e459c1b2e2302339909930caa464e97a5426cc2ca57cc15df7842");
  });

  it("签名字段齐全,且签名可用平台 CA 公钥验证", async () => {
    const { ca, signer, gm } = await build();
    const payload = {
      assignmentId: "a-1",
      taskId: "t-1",
      purpose: "PV",
      contract: { id: "c-1" },
    };
    const signed = signer.sign(
      "p-huashan",
      "rws",
      "a-1",
      payload,
      "2026-09-18T00:00:00.000Z",
    );

    expect(signed).toMatchObject({
      kind: "rws",
      taskId: "a-1",
      participantId: "p-huashan",
      issuedAt: "2026-09-18T00:00:00.000Z",
      algorithm: "SM2-SM3",
    });

    // 摘要 = 规范化内容的 SM3(连接器侧同口径:connector-task-signature.ts)
    const canonical = connectorTaskCanonical({
      participantId: "p-huashan",
      taskKind: "rws",
      taskId: "a-1",
      issuedAt: signed.issuedAt,
      payload,
    });
    expect(signed.sm3).toBe(gm.sm3Hash(canonical));

    expect(
      sm2.doVerifySignature(
        taskSignaturePayload(signed.sm3),
        signed.signature,
        ca.caPublicKey,
      ),
    ).toBe(true);
  });

  it("改一个字节的载荷即验签失败(内容被代理篡改)", async () => {
    const { ca, signer } = await build();
    const signed = signer.sign("p-huashan", "rws", "a-1", { cohortSize: 10 });
    const tamperedPayload = { cohortSize: 11 };
    // 连接器重算摘要会与签名里的摘要不符
    const canonical = connectorTaskCanonical({
      participantId: "p-huashan",
      taskKind: "rws",
      taskId: "a-1",
      issuedAt: signed.issuedAt,
      payload: tamperedPayload,
    });
    expect(canonical).not.toBe(
      connectorTaskCanonical({
        participantId: "p-huashan",
        taskKind: "rws",
        taskId: "a-1",
        issuedAt: signed.issuedAt,
        payload: { cohortSize: 10 },
      }),
    );
    // 换参与方同样改变规范化内容(任务误发给别院会被拒)
    expect(
      connectorTaskCanonical({
        participantId: "p-ruijin",
        taskKind: "rws",
        taskId: "a-1",
        issuedAt: signed.issuedAt,
        payload: { cohortSize: 10 },
      }),
    ).not.toBe(
      connectorTaskCanonical({
        participantId: "p-huashan",
        taskKind: "rws",
        taskId: "a-1",
        issuedAt: signed.issuedAt,
        payload: { cohortSize: 10 },
      }),
    );
    expect(ca.caPublicKey).toMatch(/^[0-9a-f]+$/i);
  });
});

describe("ConnectorTaskNotifier — 长轮询唤醒 (D2)", () => {
  it("notify 唤醒在等的请求", async () => {
    const { ConnectorTaskNotifier } =
      await import("./connector-task-notifier.service");
    const notifier = new ConnectorTaskNotifier();
    const waiter = notifier.begin("p-a");
    const waiting = waiter.wait(5_000);
    expect(notifier.waiting("p-a")).toBe(1);
    expect(notifier.notify("p-a")).toBe(1);
    await expect(waiting).resolves.toBe("notified");
    expect(notifier.waiting("p-a")).toBe(0);
    waiter.dispose();
  });

  it("超时返回 timeout,且不残留等待者", async () => {
    const { ConnectorTaskNotifier } =
      await import("./connector-task-notifier.service");
    const notifier = new ConnectorTaskNotifier();
    const waiter = notifier.begin("p-b");
    await expect(waiter.wait(10)).resolves.toBe("timeout");
    expect(notifier.waiting("p-b")).toBe(0);
    expect(notifier.notify("p-b")).toBe(0);
  });

  it("只唤醒对应参与方", async () => {
    const { ConnectorTaskNotifier } =
      await import("./connector-task-notifier.service");
    const notifier = new ConnectorTaskNotifier();
    const a = notifier.begin("p-a");
    const b = notifier.begin("p-b");
    const waitingA = a.wait(5_000);
    const waitingB = b.wait(5_000);
    notifier.notify("p-a");
    await expect(waitingA).resolves.toBe("notified");
    expect(notifier.waiting("p-b")).toBe(1);
    b.dispose();
    a.dispose();
    void waitingB;
  });
});
