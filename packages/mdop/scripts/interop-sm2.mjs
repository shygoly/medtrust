#!/usr/bin/env node
/**
 * SM2 与独立国密实现的**双向互验**（任务 3.3 / 规格「与独立实现互验」）。
 *
 * 两个方向都跑：
 *   A. 独立实现签 → 本实现验：`gmssl sm2sign` 出 DER，本实现验签通过。
 *   B. 本实现签 → 独立实现验：本实现签名（规范公钥写成 SPKI PEM），`gmssl sm2verify` 通过。
 * 外加一条反例：篡改后的消息在两个方向都被拒（证明不是恒真）。
 *
 * 与 gmssl 的口径对齐点：签名输入是**待签字节本身**（e = SM3(Z_A ‖ M)），
 * 用户 ID 缺省 `1234567812345678`，输出 DER —— 与 `sm-crypto` 的
 * `{ hash: true, der: true, publicKey }` 同口径。
 *
 * GmSSL 3.2 命令行的一个实测限制：`sm2sign -in <file>` 把文件当 C 字符串读，
 * **遇到第一个 0x00 就截断**（ASCII 输入照常，含 0x00 的二进制输入会被静默截断）。
 * 故本脚本选用一个**不含 0x00 字节**的 SM3 摘要作为双方共同的待签消息——
 * 这既保留了「签的是摘要字节」这一生产口径，又避开该 CLI 缺陷。
 * 摘要含 0x00 的情形由单元测试里的 GM/T 0003.5 官方测试向量覆盖。
 *
 * 工具优先级：gmssl → Tongsuo。两者都没有时：
 *   - 用本机的 OpenSSL SM2 试一遍；
 *   - OpenSSL 的 `pkeyutl -rawin -digest sm3` 经实测**不满足 GM/T 口径**
 *     （它验不过 GM/T 0003.5 附录 A 的官方测试向量），故不作为互验依据；
 *   - 如实报 SKIP 并退出 0，不假装通过。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mdop = require("../dist/index.js");

const run = (bin, args, stdio = ["ignore", "pipe", "pipe"]) =>
  execFileSync(bin, args, { stdio });

function available(bin, versionArgs = ["version"]) {
  try {
    run(bin, versionArgs);
    return true;
  } catch {
    return false;
  }
}

// ---- 极简 DER / PEM 工具（只为搬运公钥点）----
function readTlv(buf, start) {
  let pos = start;
  const tag = buf[pos++];
  let len = buf[pos++];
  if ((len & 0x80) !== 0) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[pos++];
  }
  return { start, tag, len, contentStart: pos, end: pos + len };
}

function pemToDer(pemPath) {
  const text = readFileSync(pemPath, "utf8");
  const match = /-----BEGIN [A-Z ]+-----([\s\S]*?)-----END [A-Z ]+-----/.exec(text);
  if (!match) throw new Error(`${pemPath} 不是 PEM`);
  return Buffer.from(match[1].replace(/\s+/g, ""), "base64");
}

function derToPem(der, label) {
  const b64 = der.toString("base64").replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/** 从 SPKI 中取出 algId 的字节与未压缩点 `04‖x‖y`。 */
function spkiParts(der) {
  const outer = readTlv(der, 0);
  const alg = readTlv(der, outer.contentStart);
  const bit = readTlv(der, alg.end);
  let content = der.subarray(bit.contentStart, bit.end);
  if (content[0] === 0x00) content = content.subarray(1);
  return { algBytes: der.subarray(alg.start, alg.end), point: content.toString("hex") };
}

function buildSpki(algBytes, pointHex) {
  const point = Buffer.from(pointHex, "hex");
  const bits = Buffer.concat([Buffer.from([0x00]), point]);
  const bitString = der(0x03, bits);
  return der(0x30, Buffer.concat([algBytes, bitString]));
}

function der(tag, content) {
  const len = content.length;
  let lenBytes;
  if (len < 128) lenBytes = Buffer.from([len]);
  else {
    const bytes = [];
    let n = len;
    while (n > 0) {
      bytes.unshift(n & 0xff);
      n >>= 8;
    }
    lenBytes = Buffer.from([0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), lenBytes, content]);
}

const tool = available("gmssl") ? "gmssl" : available("tongsuo") ? "tongsuo" : null;

if (!tool) {
  const opensslHasSm2 =
    available("openssl", ["version"]) &&
    available("openssl", ["genpkey", "-algorithm", "SM2", "-help"]);
  console.log(
    "[SKIP] 本机没有 gmssl / Tongsuo —— 命令行双向互验未跑（如实跳过，不算通过）。",
  );
  console.log(
    opensslHasSm2
      ? "       （本机 OpenSSL 有 SM2，但其 -rawin 口径经实测验不过 GM/T 0003.5 官方测试向量，不能作互验依据；\n" +
          "        协议核心的单元测试用该官方向量做了独立实现的交叉验证。）"
      : "       （本机也没有支持 SM2 的 OpenSSL 3.x。）",
  );
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "mdop-sm2-interop-"));
try {
  const pass = "MdopInterop#1";
  const theirKey = join(dir, "their.key.pem");
  const theirPub = join(dir, "their.pub.pem");
  const ourPub = join(dir, "our.pub.pem");
  const msgBin = join(dir, "msg.bin");
  const theirSig = join(dir, "their.sig.der");
  const ourSig = join(dir, "our.sig.der");
  const badMsg = join(dir, "bad.bin");

  // 消息 = 32 字节 SM3 摘要（与信封签名同口径），且不含 0x00 字节（见文件头说明）。
  let message;
  for (let i = 0; ; i++) {
    const candidate = Buffer.from(mdop.sm3Hex(`mdop-sm2-interop-check-${i}`), "hex");
    if (!candidate.includes(0x00)) {
      message = candidate;
      break;
    }
  }
  writeFileSync(msgBin, message);
  const tampered = Buffer.from(message);
  tampered[0] ^= 0xff;
  writeFileSync(badMsg, tampered);

  run(tool, ["sm2keygen", "-pass", pass, "-out", theirKey, "-pubout", theirPub]);
  const theirSpki = pemToDer(theirPub);
  const { algBytes, point: theirPoint } = spkiParts(theirSpki);

  // ---- 方向 A：独立实现签 → 本实现验 ----
  run(tool, [
    "sm2sign",
    "-key",
    theirKey,
    "-pass",
    pass,
    "-id",
    "1234567812345678",
    "-in",
    msgBin,
    "-out",
    theirSig,
  ]);
  const theirSigHex = readFileSync(theirSig).toString("hex");
  if (!mdop.sm2Verify(message, theirSigHex, theirPoint))
    throw new Error(`${tool} 的签名没能通过本实现验签`);
  console.log(`[OK] 方向 A：${tool} 签 → 本实现验 通过`);

  // ---- 方向 B：本实现签 → 独立实现验 ----
  const ours = mdop.generateSm2KeyPair();
  writeFileSync(ourPub, derToPem(buildSpki(algBytes, ours.publicKey), "PUBLIC KEY"));
  writeFileSync(ourSig, Buffer.from(mdop.sm2Sign(message, ours.privateKey, { publicKey: ours.publicKey }), "hex"));
  run(tool, ["sm2verify", "-pubkey", ourPub, "-in", msgBin, "-sig", ourSig]);
  console.log(`[OK] 方向 B：本实现签 → ${tool} 验 通过`);

  // ---- 反例：篡改后的消息在两个方向都被拒 ----
  if (mdop.sm2Verify(tampered, theirSigHex, theirPoint))
    throw new Error("反例失败：篡改的消息竟被本实现接受");
  let gmsslRejected;
  try {
    run(tool, ["sm2verify", "-pubkey", ourPub, "-in", badMsg, "-sig", ourSig]);
    gmsslRejected = false;
  } catch {
    gmsslRejected = true;
  }
  if (!gmsslRejected) throw new Error(`反例失败：篡改的消息竟被 ${tool} 接受`);
  console.log("[OK] 反例：篡改后的消息在两个方向都被拒");

  console.log(`\nSM2 双向互验通过（${tool}）`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
