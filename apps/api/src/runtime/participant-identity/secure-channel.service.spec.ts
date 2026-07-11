import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { SecureChannelService, IntegrityError } from "./secure-channel.service";

describe("SecureChannelService — SM2 加密 + SM3 完整性 + 签名 (2.3)", () => {
  let gm: GMCryptoService;
  let ch: SecureChannelService;
  let sender: { publicKey: string; privateKey: string };
  let recipient: { publicKey: string; privateKey: string };

  beforeEach(() => {
    gm = new GMCryptoService();
    ch = new SecureChannelService(gm);
    sender = gm.generateSM2KeyPair();
    recipient = gm.generateSM2KeyPair();
  });

  it("round-trips a sealed message", () => {
    const msg = ch.seal(
      "任务下发:rws-2041",
      sender.privateKey,
      recipient.publicKey,
    );
    const out = ch.open(msg, recipient.privateKey, sender.publicKey);
    expect(out).toBe("任务下发:rws-2041");
  });

  it("drops a tampered message (digest altered)", () => {
    const msg = ch.seal("原始指令", sender.privateKey, recipient.publicKey);
    const tampered = { ...msg, digest: msg.digest.replace(/.$/, "0") };
    expect(() =>
      ch.open(tampered, recipient.privateKey, sender.publicKey),
    ).toThrow(IntegrityError);
  });

  it("rejects a message signed by the wrong sender", () => {
    const msg = ch.seal("原始指令", sender.privateKey, recipient.publicKey);
    const impostor = gm.generateSM2KeyPair();
    expect(() =>
      ch.open(msg, recipient.privateKey, impostor.publicKey),
    ).toThrow(IntegrityError);
  });
});
