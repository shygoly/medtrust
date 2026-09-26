// on-chain-provider-endorsement —— 独立核验(task 4.1 / 4.2 / 4.3)。
//
// 两条路径都测:
//   ① 平台提供的便利核验端点(controller);
//   ② scripts/verify-endorsement.mjs —— **离线**核验器,只吃「链上 payload + CA 公钥 +
//      证书目录」,不认识平台。它才是「脱离平台也能验」这句话的证据,所以这里真的
//      spawn 它、真的看退出码。
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sm2 } from "sm-crypto";
import { sm2Sign } from "@medtrust/mdop";
import {
  CaKeypair,
  Certificate as CertificateEntity,
} from "@medtrust/database";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";
import { mockRepo } from "../test-utils/mock-repo";
import { resultEndorsementPayload } from "../rws-orchestrator/result-endorsement";
import { EndorsementVerificationController } from "./endorsement-verification.controller";

const SCRIPT = resolve(
  __dirname,
  "../../../../../scripts/verify-endorsement.mjs",
);
const RESULT_SM3 = "a".repeat(64);
const HUASHAN = "p-huashan";

describe("存证背书独立核验 (on-chain-provider-endorsement §4)", () => {
  let gm: GMCryptoService;
  let ca: CaService;
  let certRepo: ReturnType<typeof mockRepo<CertificateEntity>>;
  let controller: EndorsementVerificationController;
  let connectorKeys: { publicKey: string; privateKey: string };
  let fingerprint: string;
  let sig: string;

  beforeEach(async () => {
    gm = new GMCryptoService();
    certRepo = mockRepo<CertificateEntity>();
    ca = new CaService(gm, mockRepo<CaKeypair>(), certRepo, "sh-med");
    await ca.onModuleInit();

    connectorKeys = gm.generateSM2KeyPair();
    const cert = await ca.issue("c-huashan", HUASHAN, connectorKeys.publicKey);
    fingerprint = cert.fingerprint;
    // 当前口径：国标 SM2（切换后上链的背书必须是这个）
    sig = sm2Sign(
      resultEndorsementPayload(RESULT_SM3),
      connectorKeys.privateKey,
    );
    controller = new EndorsementVerificationController(ca, gm, certRepo);
  });

  describe("信任锚发布 (task 4.2)", () => {
    it("公开 CA 公钥 + 背书载荷口径,第三方据此可离线重建被签消息", () => {
      const anchor = controller.trustAnchor();
      expect(anchor.caPublicKey).toBe(ca.caPublicKey);
      expect(anchor.algorithm).toBe("SM2");
      expect(anchor.endorsementPayloadPrefix).toBe(
        "medtrust.result-endorsement.v1:",
      );
      // 如实边界:不得把 L1 说成「无单一可信运营方」(design D4)。
      expect(anchor.note).toMatch(/单节点/);
      expect(anchor.note).toMatch(/不保证平台不遗漏/);
    });

    it("证书目录带 CA 签名(否则第三方验不了证书链)", async () => {
      const dir = await controller.certificates(HUASHAN);
      expect(dir.certificates).toHaveLength(1);
      const [c] = dir.certificates;
      expect(c.caSignature).toBeTruthy();
      expect(c.subjectPublicKey).toBe(connectorKeys.publicKey);
      expect(c.revoked).toBe(false);
    });
  });

  describe("便利核验端点", () => {
    it("真背书 → 五步全过", async () => {
      const r = await controller.verifyEndorsement({
        resultSm3: RESULT_SM3,
        sig,
        certFingerprint: fingerprint,
        participantId: HUASHAN,
      });
      expect(r.valid).toBe(true);
      expect(r.steps).toEqual({
        certificateFound: true,
        certificateChainValid: true,
        certificateActive: true,
        participantMatches: true,
        endorsementSignatureValid: true,
      });
      // 当前口径的记录标注国标格式（D-MDOP-3）。
      expect(r.signatureAlg).toBe("SM2-SM3");
    });

    it("切换前的旧格式背书仍可核验，但如实标注为历史格式", async () => {
      // 切换前的连接器口径：不做 Z_A、原始 r‖s。历史存证必须仍可独立核验 ——
      // 否则上链记录会因一次签名升级全部失效。核验面按「先国标、后历史」处理并标注格式。
      const legacySig = sm2.doSignature(
        resultEndorsementPayload(RESULT_SM3),
        connectorKeys.privateKey,
      );
      const r = await controller.verifyEndorsement({
        resultSm3: RESULT_SM3,
        sig: legacySig,
        certFingerprint: fingerprint,
        participantId: HUASHAN,
      });
      expect(r.valid).toBe(true);
      expect(r.signatureAlg).toBe("SM2-legacy-raw");
    });

    it("篡改链上 resultSm3 → 核验失败 (task 4.3)", async () => {
      const r = await controller.verifyEndorsement({
        resultSm3: "b".repeat(64),
        sig,
        certFingerprint: fingerprint,
      });
      expect(r.valid).toBe(false);
      expect(r.steps.endorsementSignatureValid).toBe(false);
      expect(r.reason).toMatch(/篡改/);
    });

    it("篡改签名 → 核验失败 (task 4.3)", async () => {
      const r = await controller.verifyEndorsement({
        resultSm3: RESULT_SM3,
        sig: sig.slice(0, -2) + (sig.endsWith("00") ? "11" : "00"),
        certFingerprint: fingerprint,
      });
      expect(r.valid).toBe(false);
      expect(r.steps.endorsementSignatureValid).toBe(false);
    });

    it("冒名顶替(指纹属于别家)→ 核验失败", async () => {
      const r = await controller.verifyEndorsement({
        resultSm3: RESULT_SM3,
        sig,
        certFingerprint: fingerprint,
        participantId: "p-ruijin",
      });
      expect(r.valid).toBe(false);
      expect(r.steps.participantMatches).toBe(false);
    });

    it("证书已吊销 → 核验失败", async () => {
      await ca.revoke(fingerprint);
      const r = await controller.verifyEndorsement({
        resultSm3: RESULT_SM3,
        sig,
        certFingerprint: fingerprint,
      });
      expect(r.valid).toBe(false);
      expect(r.steps.certificateActive).toBe(false);
    });

    it("指纹不在目录 → 核验失败", async () => {
      const r = await controller.verifyEndorsement({
        resultSm3: RESULT_SM3,
        sig,
        certFingerprint: "SM2:NOPE",
      });
      expect(r.valid).toBe(false);
      expect(r.steps.certificateFound).toBe(false);
    });
  });

  describe("离线核验器 scripts/verify-endorsement.mjs (task 4.1/4.3)", () => {
    let dir: string;

    async function writeFixtures(
      endorsements: Array<Record<string, unknown>>,
    ): Promise<{ attestation: string; anchor: string; certs: string }> {
      dir = mkdtempSync(join(tmpdir(), "medtrust-endorse-"));
      const files = {
        attestation: join(dir, "onchain.json"),
        anchor: join(dir, "anchor.json"),
        certs: join(dir, "certs.json"),
      };
      writeFileSync(files.attestation, JSON.stringify({ endorsements }));
      writeFileSync(files.anchor, JSON.stringify(controller.trustAnchor()));
      writeFileSync(
        files.certs,
        JSON.stringify(await controller.certificates()),
      );
      return files;
    }

    function runVerifier(files: {
      attestation: string;
      anchor: string;
      certs: string;
    }): { code: number; out: string } {
      try {
        const out = execFileSync(
          process.execPath,
          [
            SCRIPT,
            "--attestation",
            files.attestation,
            "--anchor",
            files.anchor,
            "--certs",
            files.certs,
          ],
          { encoding: "utf8" },
        );
        return { code: 0, out };
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        return {
          code: e.status ?? 1,
          out: `${e.stdout ?? ""}${e.stderr ?? ""}`,
        };
      }
    }

    it("真背书 → 离线核验通过(全程未询问平台判断)", async () => {
      const files = await writeFixtures([
        {
          participantId: HUASHAN,
          resultSm3: RESULT_SM3,
          sig,
          certFingerprint: fingerprint,
        },
      ]);
      const { code, out } = runVerifier(files);
      expect(out).toMatch(/背书有效/);
      expect(out).toMatch(/独立核验通过/);
      expect(code).toBe(0);
    });

    it("切换前上链的旧格式背书仍能离线核验（带切换前时间戳）", async () => {
      const legacySig = sm2.doSignature(
        resultEndorsementPayload(RESULT_SM3),
        connectorKeys.privateKey,
      );
      const files = await writeFixtures([
        {
          participantId: HUASHAN,
          resultSm3: RESULT_SM3,
          sig: legacySig,
          certFingerprint: fingerprint,
          // 记录时间早于切换点 → 旧格式被接受，并如实标注
          at: "2026-09-01T00:00:00.000Z",
        },
      ]);
      const { code, out } = runVerifier(files);
      expect(out).toMatch(/SM2-legacy-raw/);
      expect(code).toBe(0);
    });

    it("切换后的记录只给旧格式签名 → 离线核验失败（不得降级）", async () => {
      const legacySig = sm2.doSignature(
        resultEndorsementPayload(RESULT_SM3),
        connectorKeys.privateKey,
      );
      const files = await writeFixtures([
        {
          participantId: HUASHAN,
          resultSm3: RESULT_SM3,
          sig: legacySig,
          certFingerprint: fingerprint,
          at: "2026-09-25T00:00:00.000Z",
        },
      ]);
      const { code, out } = runVerifier(files);
      expect(code).toBe(1);
      expect(out).toMatch(/切换点|不是国标口径/);
    });

    it("篡改链上 resultSm3 → 离线核验失败 (task 4.3)", async () => {
      const files = await writeFixtures([
        {
          participantId: HUASHAN,
          resultSm3: "c".repeat(64),
          sig,
          certFingerprint: fingerprint,
        },
      ]);
      const { code, out } = runVerifier(files);
      expect(code).toBe(1);
      expect(out).toMatch(/核验失败/);
    });

    it("平台伪造某院背书(用自己的密钥签)→ 离线核验失败", async () => {
      const platformKeys = gm.generateSM2KeyPair();
      const files = await writeFixtures([
        {
          participantId: HUASHAN,
          resultSm3: RESULT_SM3,
          sig: sm2Sign(
            resultEndorsementPayload(RESULT_SM3),
            platformKeys.privateKey,
          ),
          certFingerprint: fingerprint,
        },
      ]);
      const { code } = runVerifier(files);
      expect(code).toBe(1);
    });

    it("存证无任何背书(渐进期旧记录)→ 明确报「无背书」而非假装通过", async () => {
      const files = await writeFixtures([]);
      const { code, out } = runVerifier(files);
      expect(code).toBe(1);
      expect(out).toMatch(/未含任何连接器背书/);
    });
  });
});
