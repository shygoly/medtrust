import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * T4 方案 C+D（2026-09-27 已拍板）：C2 永不走院内 `TeeEnclave`。
 * 这不是观察，是必须一直成立的路径隔离——一旦 tee-node / mdop attestation
 * 接上 `SoftwareSealedCompute` 或把 `TeeAttestation` 当成协议报告，两条 seal 就会焊在一起。
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const SCAN_DIRS = [
  'apps/connector/src/tee-node',
  'packages/mdop/src/attestation',
];
const FORBIDDEN = /\b(?:SoftwareSealedCompute|TeeEnclave|TeeAttestation)\b/;

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.(spec|test)\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 追溯表 symbol：生产文件去注释后不得出现院内 TeeEnclave 契约名。 */
export function assertC2NeverUsesConnectorTeeEnclave(): string[] {
  const hits: string[] = [];
  for (const rel of SCAN_DIRS) {
    for (const full of walkTs(join(REPO_ROOT, rel))) {
      const code = stripComments(readFileSync(full, 'utf8'));
      if (FORBIDDEN.test(code)) hits.push(relative(REPO_ROOT, full));
    }
  }
  return hits;
}

describe('C2 路径与院内 TeeEnclave 隔离（T4 方案 C+D）', () => {
  it('C2 不得经 TeeEnclave 产生信封：tee-node 与 mdop attestation 生产代码零引用院内契约', () => {
    const hits = assertC2NeverUsesConnectorTeeEnclave();
    expect(hits).toEqual([]);
  });
});
