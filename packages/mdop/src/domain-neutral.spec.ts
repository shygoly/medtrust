import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * D2 / 任务 3.1：本包 MUST NOT 出现患者、诊断、用药等医疗领域词。
 * 医疗 schema 放在调用方；协议核心保持领域中立，才能被平台与连接器共同依赖。
 */

const DOMAIN_TERMS = [
  "患者",
  "诊断",
  "用药",
  "医疗",
  "医院",
  "病历",
  "处方",
  "疾病",
  "病人",
  "patient",
  "diagnos",
  "medicat",
  "drug",
  "disease",
  "hospital",
  "clinical",
  "cohort",
  "synthea",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

describe("domain neutrality (D2 / 任务 3.1)", () => {
  const srcDir = __dirname;

  it("源码里不出现医疗领域词", () => {
    // 本测试文件自身列举了这些词，故排除自己。
    const files = walk(srcDir).filter((f) => !f.endsWith("domain-neutral.spec.ts"));
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8").toLowerCase();
      for (const term of DOMAIN_TERMS) {
        if (text.includes(term.toLowerCase()))
          hits.push(`${file.slice(srcDir.length + 1)}: ${term}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
