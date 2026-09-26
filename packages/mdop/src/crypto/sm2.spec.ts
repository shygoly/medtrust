import {
  DEFAULT_SM2_USER_ID,
  SM2_ALGORITHM,
  generateSm2KeyPair,
  normalizePublicKey,
  publicKeyFromPrivateKey,
  publicKeyKid,
  signCanonicalObject,
  sm2Sign,
  sm2Verify,
  verifyCanonicalObject,
  verifyLegacySm2,
} from "./sm2";
import { sm3Hex } from "./sm3";
import { canonicalize } from "../canonical/jcs";
import { MdopError } from "../errors";

describe("国标 SM2（GM/T 0003：Z_A + DER）", () => {
  const keys = generateSm2KeyPair();

  it("公钥形状是 04‖x‖y 未压缩点，kid 是公钥 SM3 全长（64 位字符）", () => {
    expect(keys.publicKey).toMatch(/^04[0-9a-f]{128}$/);
    expect(keys.privateKey).toMatch(/^[0-9a-f]{64}$/);
    const kid = publicKeyKid(keys.publicKey);
    expect(kid).toMatch(/^[0-9a-f]{64}$/);
    expect(kid).toBe(sm3Hex(Buffer.from(keys.publicKey, "hex")));
  });

  it("无前缀的 x‖y 形式归一为未压缩点", () => {
    expect(normalizePublicKey(keys.publicKey.slice(2))).toBe(keys.publicKey);
    expect(normalizePublicKey(keys.publicKey.toUpperCase())).toBe(keys.publicKey);
  });

  it("私钥可推出同一公钥", () => {
    expect(publicKeyFromPrivateKey(keys.privateKey)).toBe(keys.publicKey);
  });

  it("签名是 DER 结构且能验回", () => {
    const message = Buffer.from(sm3Hex("hello mdop"), "hex");
    const signature = sm2Sign(message, keys.privateKey, { publicKey: keys.publicKey });
    // DER: SEQUENCE(0x30) len INTEGER(0x02) len r INTEGER(0x02) len s
    const bytes = Buffer.from(signature, "hex");
    expect(bytes[0]).toBe(0x30);
    expect(bytes[1]).toBe(bytes.length - 2);
    let pos = 2;
    expect(bytes[pos]).toBe(0x02);
    const rLen = bytes[pos + 1];
    pos += 2 + rLen;
    expect(bytes[pos]).toBe(0x02);
    const sLen = bytes[pos + 1];
    expect(pos + 2 + sLen).toBe(bytes.length);
    expect(sm2Verify(message, signature, keys.publicKey)).toBe(true);
  });

  it("缺省用户 ID 是 1234567812345678", () => {
    expect(DEFAULT_SM2_USER_ID).toBe("1234567812345678");
  });

  it("换一个用户 ID 验不过（证明 Z_A 真的用上了）", () => {
    const message = "payload";
    const signature = sm2Sign(message, keys.privateKey, { publicKey: keys.publicKey });
    expect(sm2Verify(message, signature, keys.publicKey)).toBe(true);
    expect(sm2Verify(message, signature, keys.publicKey, { userId: "other-id" })).toBe(false);
  });

  it("篡改消息即验不过", () => {
    const signature = sm2Sign("a", keys.privateKey, { publicKey: keys.publicKey });
    expect(sm2Verify("b", signature, keys.publicKey)).toBe(false);
  });

  it("用错公钥验不过", () => {
    const other = generateSm2KeyPair();
    const signature = sm2Sign("a", keys.privateKey, { publicKey: keys.publicKey });
    expect(sm2Verify("a", signature, other.publicKey)).toBe(false);
  });

  it("对规范化对象签验，且 alg=SM2-SM3、kid 与公钥一致", () => {
    const obj = { b: 1, a: [1, 2, 3] };
    const sig = signCanonicalObject(obj, keys.privateKey, { publicKey: keys.publicKey });
    expect(sig.alg).toBe(SM2_ALGORITHM);
    expect(sig.kid).toBe(publicKeyKid(keys.publicKey));
    expect(verifyCanonicalObject(obj, sig, keys.publicKey)).toBe(true);
    // 字段顺序无关
    expect(verifyCanonicalObject({ a: [1, 2, 3], b: 1 }, sig, keys.publicKey)).toBe(true);
    // 任一字段变化即失效
    expect(verifyCanonicalObject({ a: [1, 2, 3], b: 2 }, sig, keys.publicKey)).toBe(false);
  });

  it("签名内容确实是 JCS 后的 SM3（换规范化实现会验不过）", () => {
    // JSON.stringify 保留插入顺序；JCS 对成员排序，故两者摘要不同。
    const obj = { b: 1, a: 2, x: "\u000f" };
    const sig = signCanonicalObject(obj, keys.privateKey, { publicKey: keys.publicKey });
    const digest = Buffer.from(sm3Hex(canonicalize(obj)), "hex");
    expect(sm2Verify(digest, sig.value, keys.publicKey)).toBe(true);
    const wrong = Buffer.from(sm3Hex(JSON.stringify(obj)), "hex");
    expect(sm2Verify(wrong, sig.value, keys.publicKey)).toBe(false);
  });

  it("旧格式（无 Z_A、原始 r‖s）只在 verifyLegacy 通道被接受", () => {
    // 用 sm-crypto 缺省参数造一条旧格式签名（不做 Z_A、非 DER）。
    const legacy = require("sm-crypto").sm2.doSignature("legacy-message", keys.privateKey);
    expect(legacy).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyLegacySm2("legacy-message", legacy, keys.publicKey)).toBe(true);
    // 国标通道不接受旧格式
    expect(sm2Verify("legacy-message", legacy, keys.publicKey)).toBe(false);
  });

  it("非法私钥/公钥形状抛 E_AUTH_INVALID", () => {
    expect(() => sm2Sign("x", "not-a-key")).toThrow(MdopError);
    expect(() => normalizePublicKey("zz")).toThrow(MdopError);
  });

  /**
   * 回归：sm-crypto 的 arrayToHex 用 TypedArray.map，会把十六进制字符串强转回数字
   * （"cb" → NaN → 0）。若不摊平成普通数组，签名会与真实字节脱钩——Buffer 签、Buffer 验
   * 仍能通过（两边一起错），只有与独立实现或不同表示的输入对拍才暴露。
   */
  it("字节消息必须真正被签进去（Buffer 与等值数组/十六进制串互认）", () => {
    const digestHex = "64cb346cdd3ccb65775884cafacdb126062fd8dd9b34ac07dc809bba199f7fe2";
    const buffer = Buffer.from(digestHex, "hex");
    const signature = sm2Sign(buffer, keys.privateKey, { publicKey: keys.publicKey });
    expect(sm2Verify(Array.from(buffer), signature, keys.publicKey)).toBe(true);
    expect(sm2Verify(new Uint8Array(buffer), signature, keys.publicKey)).toBe(true);
    // 与真实摘要绑定：改一个字节即失败
    const tampered = Buffer.from(buffer);
    tampered[0] ^= 0x01;
    expect(sm2Verify(tampered, signature, keys.publicKey)).toBe(false);
  });

  /**
   * 官方测试向量（GM/T 0003.5-2012 附录 A）——由国家标准的独立实现产生，
   * 是「与独立实现互验」的常驻证据（不依赖本机是否装了 gmssl）。
   */
  it("验得过 GM/T 0003.5 附录 A 的官方测试向量", () => {
    const vectorPublicKey =
      "04" +
      "09f9df311e5421a150dd7d161e4bc5c672179fad1833fc076bb08ff356f35020" +
      "ccea490ce26775a52dc6ea718cc1aa600aed05fbf35e084a6632f6072da9ad13";
    const r = "F5A03B0648D2C4630EEAC513E1BB81A15944DA3827D5B74143AC7EACEEE720B3";
    const s = "B1B6AA29DF212FD8763182BC0D421CA1BB9038FD1F7F42D4840B69C485BBC1AA";
    const signature = ("3044" + "0220" + r + "0220" + s).toLowerCase();
    expect(signature).toHaveLength(140);
    expect(sm2Verify("message digest", signature, vectorPublicKey)).toBe(true);
    // 换用户 ID 或改消息都验不过
    expect(sm2Verify("message digest", signature, vectorPublicKey, { userId: "" })).toBe(false);
    expect(sm2Verify("message digesu", signature, vectorPublicKey)).toBe(false);
  });
});
