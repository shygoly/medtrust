import { UnauthorizedException } from "@nestjs/common";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { mockRepo } from "../test-utils/mock-repo";
import { connectorEnrollPayload } from "./connector-enrollment";
import { ConnectorEnrollmentService } from "./connector-enrollment.service";

describe("ConnectorEnrollmentService", () => {
  const gm = new GMCryptoService();
  const pair = gm.generateSM2KeyPair();

  function service(admin = { issuePresentedPublicKey: jest.fn() }) {
    return {
      admin,
      svc: new ConnectorEnrollmentService(mockRepo() as never, admin as never, gm),
    };
  }

  function signed(over: Partial<{ timestamp: string; connectorId: string; participantId: string; subjectPublicKey: string }> = {}) {
    const input = {
      timestamp: Date.now().toString(),
      connectorId: "cn-demohospa",
      participantId: "p-demohospa",
      subjectPublicKey: pair.publicKey,
      ...over,
    };
    return {
      ...input,
      signature: gm.sm2Sign(connectorEnrollPayload(input), pair.privateKey, { publicKey: pair.publicKey }),
    };
  }

  it("验签通过后进入待批准，批准时用申请里的公钥签发", async () => {
    const { svc, admin } = service();
    admin.issuePresentedPublicKey.mockResolvedValue({
      connectorId: "cn-demohospa",
      certificate: { fingerprint: "SM2:ABCDEF1234567890" },
    });
    const pending = await svc.submit(signed());
    expect(pending.status).toBe("pending");
    const approved = await svc.approve(pending.id);
    expect(admin.issuePresentedPublicKey).toHaveBeenCalledWith({
      connectorId: "cn-demohospa",
      participantId: "p-demohospa",
      subjectPublicKey: pair.publicKey,
    });
    expect(approved.fingerprint).toBe("SM2:ABCDEF1234567890");
    expect(approved.status).toBe("approved");
  });

  it("公钥与签名不是一对时拒绝", async () => {
    const { svc } = service();
    const other = gm.generateSM2KeyPair();
    const body = signed({ subjectPublicKey: other.publicKey });
    await expect(svc.submit(body)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
