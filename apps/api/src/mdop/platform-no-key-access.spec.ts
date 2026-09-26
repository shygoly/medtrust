import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 设计约束的防回归断言（任务 5.7）：**平台不得有任何获取 C2 数据密钥的路径**。
 *
 * 这不是「当前恰好没有」的观察，而是一条**必须一直成立**的约束：一旦有人在平台侧接上
 * 解密/解封能力（哪怕是「临时调试用」），C2 的整个前提就没了——平台会变成绕过 TEE 的超级节点。
 * 因此用源码扫描把它钉住：出现这些模式即测试失败，必须走 design review 才能改。
 *
 * 与 `packages/mdop` 的 `attestation/provider.ts`（判定）和连接器侧的 `unseal`（真正的解封）
 * 分工互补：**解封只发生在可信空间节点内**，平台这一侧不该有。
 */

/** 从仓库根定位 apps/api/src（jest 的 cwd 是 apps/api）。 */
const API_SRC = resolve(process.cwd(), "src");

/** 平台侧禁止出现的模式（按语义分组，命中即失败）。 */
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\bunseal\w*\s*\(/i,
    why: "平台不得解封 C2 信封（解封只在可信空间节点内发生）",
  },
  { pattern: /\bunwrapDataKey\b|\bunwrapKey\b/, why: "平台不得解包数据密钥" },
  {
    pattern: /\breleaseDataKey\b|\bkmsDecrypt\b/,
    why: "平台不得调用 KMS 释放/解密数据密钥",
  },
  {
    pattern: /@Post\(\s*["'][^"']*keys?["']/i,
    why: "平台不得暴露任何「取密钥」的 HTTP 入口",
  },
  {
    pattern: /\bdecryptEnvelope\b|\bopenEnvelope\b/,
    why: "平台不得实现信封解密",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts"))
      out.push(full);
  }
  return out;
}

describe("平台不得接触 C2 数据密钥（任务 5.7 的设计约束）", () => {
  it("apps/api 源码里没有任何解封 / 解包 / 取密钥的路径", () => {
    const hits: string[] = [];
    for (const file of walk(API_SRC)) {
      const src = readFileSync(file, "utf8");
      for (const { pattern, why } of FORBIDDEN) {
        const m = src.match(pattern);
        if (m)
          hits.push(
            `${file.slice(API_SRC.length + 1)}: ${why}（命中 ${m[0].trim()}）`,
          );
      }
    }
    expect(hits).toEqual([]);
  });

  it("证明登记服务只保存证明摘要与度量，不保存任何可解密材料", () => {
    const src = readFileSync(
      join(API_SRC, "mdop", "mdop-attestation.service.ts"),
      "utf8",
    );
    // 允许出现 key_id（信封里的引用）；不允许出现密钥本体字段
    for (const forbidden of [
      "privateKey",
      "secretKey",
      "plaintext",
      "ciphertext",
    ])
      expect(src).not.toContain(forbidden);
  });

  it("释放判据里平台侧只有「已校验结果」的入参，没有原始 quote 校验能力", () => {
    const src = readFileSync(
      join(API_SRC, "mdop", "mdop-attestation.service.ts"),
      "utf8",
    );
    // 平台侧的判定是 assertUsableForC2（信任已配置校验方）；真正验 quote 的是连接器/KMS 侧
    expect(src).toContain("assertUsableForC2");
    expect(src).not.toContain("verifyQuoteDigest(");
  });
});
