import { generateSm2KeyPair } from "../crypto/sm2";
import {
  assertMonotonicVersion,
  parseRevocationList,
  signRevocationList,
  verifyRevocationList,
} from "./revocation";

const digest = (c: string) => `sm3:${c.repeat(64)}`;

describe("算子吊销名单（D-MDOP-5 / 规格「签名吊销名单同步」）", () => {
  const platformNode = generateSm2KeyPair();
  const other = generateSm2KeyPair();

  const base = {
    version: 3,
    issued_at: "2026-09-24T00:00:00.000Z",
    revoked_digests: [digest("a")],
  };

  it("用平台节点密钥签，同一公钥验得过", () => {
    const list = signRevocationList(base, platformNode.privateKey, platformNode.publicKey);
    expect(list.sig.alg).toBe("SM2-SM3");
    expect(verifyRevocationList(list, platformNode.publicKey)).toBe(true);
    expect(parseRevocationList(list).revoked_digests).toEqual([digest("a")]);
  });

  it("换一把密钥验不过（用错用途/身份的对象一律拒）", () => {
    const list = signRevocationList(base, platformNode.privateKey, platformNode.publicKey);
    expect(verifyRevocationList(list, other.publicKey)).toBe(false);
  });

  it("篡改名单内容即验不过（版本与摘要集都在签名范围内）", () => {
    const list = signRevocationList(base, platformNode.privateKey, platformNode.publicKey);
    expect(
      verifyRevocationList({ ...list, revoked_digests: [digest("b")] }, platformNode.publicKey),
    ).toBe(false);
    expect(verifyRevocationList({ ...list, version: 4 }, platformNode.publicKey)).toBe(false);
  });

  it("版本单调：低版本拒、同版本同内容可重复、同版本不同内容拒", () => {
    const local = { version: 3, revoked_digests: [digest("a")] };
    // 版本单调只看版本号与摘要集（签名的有效性由 verifyRevocationList 单独负责）
    const sign = (over: Partial<typeof base>) =>
      signRevocationList({ ...base, ...over }, platformNode.privateKey, platformNode.publicKey);
    expect(() => assertMonotonicVersion(sign({ version: 4 }), local)).not.toThrow();
    expect(() => assertMonotonicVersion(sign({}), local)).not.toThrow();
    expect(() => assertMonotonicVersion(sign({ version: 2 }), local)).toThrow(/版本回退/);
    expect(() =>
      assertMonotonicVersion(sign({ revoked_digests: [digest("c")] }), local),
    ).toThrow(/同版本内容不一致/);
  });
});
