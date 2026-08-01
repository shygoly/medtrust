// governance.adapter.mjs — MedTrust × ai-factory 校验器唯一接口
//
// 工厂的校验器不知道本项目的 TypeORM + NestJS + 双平面（control/connector）技术栈，
// 只认元语的 schema（FINV-4）。代码侧事实由本文件以闭集形式提供。
//
// ## 与 scripts/check-meta-docs.mjs 的关系
// MedTrust 自有 check-meta-docs.mjs 覆盖比工厂六检查更严的合规面（TRUST/AGENT/R1-R4 平面登记/
// 出域闸/payload 红线）。本 adapter 只提供工厂通用 schema 对拍所需的代码侧闭集，
// 两者并存：工厂守元语 schema 一致性，check-meta-docs 守 MedTrust 专属合规。
//
// ## 适配器契约（VC-11 / VC-12）
//   - 只用 node: 标准库，不 import 工厂内部模块（FR-14）。
//   - 返回 null = 不适用该维度 → 可见跳过（警告），绝不假阳性（FINV-8）。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(import.meta.url), '..');

const IGNORE_ALWAYS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nx', 'coverage', '.agent-runs']);
const readText = (rel) => {
  try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; }
};

/** 递归遍历 dirRel，返回满足 predicate 的仓库相对路径。 */
function walk(dirRel, predicate = () => true) {
  const abs = join(root, dirRel);
  const out = [];
  let stack;
  try { stack = readdirSync(abs).map((n) => ({ dir: abs, base: dirRel, name: n })); }
  catch { return out; }
  while (stack.length) {
    const { dir, base, name } = stack.pop();
    if (IGNORE_ALWAYS.has(name)) continue;
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      for (const child of readdirSync(full)) stack.push({ dir: full, base: rel, name: child });
    } else if (predicate(rel, full)) {
      out.push(rel);
    }
  }
  return out;
}

export default {
  root,

  // ── 元语文件位置 ──────────────────────────────────────────
  // MedTrust 自建元语（TRUST/AGENT/EVIDENCE）不在 ASFAS 标准集，不纳入工厂校验面。
  // AGENT-OPS.md 是 ASFAS 条件元语（本仓由 coding agent 写，触发）。
  metaFiles: {
    ARCHITECTURE: 'ARCHITECTURE.md',
    DESIGN: 'DESIGN.md',
    DOMAIN: 'DOMAIN.md',
    FLOWS: 'FLOWS.md',
    DECISIONS: 'DECISIONS.md',
    DEPLOY: 'DEPLOY.md',
    // AGENTS.md 已重构为 ASFAS 入口指针（顶部抬头块）+ 保留 opencode 配置。
    AGENTS: 'AGENTS.md',
    AI: null,                // MedTrust 产品面的 AI 由 AGENT.md 治理（自建元语），不触发 ASFAS AI.md
    'AGENT-OPS': 'AGENT-OPS.md',  // C2：coding agent 动作治理契约（本仓由 coding agent 写，触发）
  },

  // ── DECISIONS.md 的 ID 命名空间（附录 B.3）────────────────
  // 与 check-meta-docs.mjs / AGENT.md 的命名空间一致。词边界匹配，前缀不得互为前缀。
  idPrefixes: ['INV', 'D', 'CTL', 'EVD', 'FLOW', 'TD', 'AGT'],

  // ── 跳过钩子（VC-12 延伸）─────────────────────────────────
  // MedTrust 的 DOMAIN/FLOWS/DECISIONS 用 YAML 围栏块体系（为其自有 check-meta-docs.mjs 设计），
  // 工厂内容检查器认 markdown 表格/```flow 块，格式不兼容。这三项声明跳过——
  // 它们由 check-meta-docs.mjs 守护（覆盖矩阵/@Entity 对拍/invariant/payload 红线/决策在册，
  // 比工厂六检查更严且含 MedTrust 专属合规）。
  // DEPLOY 同样跳过：MedTrust env 分文件治理（.env.example 本地 / .env.fly.example 部署 /
  // connector），fly 键走仓外 fly secrets——工厂"单一 .env.example 三方全等"模型结构性不适用
  // （DEPLOY §4 已登记该漂移 FP-7；自有校验器对此面只 WARN 不红）。
  // 工厂校验对 MedTrust 只跑适用的 FC（格式契约先验）+ AGENTS（入口指针）。
  skipChecks: ['DOMAIN', 'FLOWS', 'DECISIONS', 'DEPLOY'],
  idScanSurface: ['apps', 'packages', 'scripts'],
  idScanExts: ['.ts', '.tsx', '.mjs', '.sql'],

  // ── DOMAIN 对拍 ────────────────────────────────────────────
  /** @returns {string[]|null} TypeORM @Entity 表名闭集 */
  schemaObjects() {
    // 扫描 packages/database/src 全部 .ts，提取 @Entity('table_name')
    const files = walk('packages/database/src', (p) => p.endsWith('.ts'));
    const names = new Set();
    for (const f of files) {
      const t = readText(f);
      if (t == null) continue;
      for (const m of t.matchAll(/@Entity\(\s*['"]([a-z_]+)['"]/g)) names.add(m[1]);
    }
    return names.size ? [...names] : null;
  },

  /** @returns {Record<string,string[]>|null} 枚举名 → 有序取值 */
  schemaEnums() {
    // MedTrust 用 TypeORM 无 pgEnum；枚举以 TS enum 或字符串字面量联合形式存在于实体里，
    // 无法像 pgEnum 那样稳定提取有序闭集。返回 null → DOMAIN 枚举对拍可见跳过（VC-12）。
    return null;
  },

  // ── FLOWS 对拍 ─────────────────────────────────────────────
  /**
   * MedTrust 的 FLOWS.md 用 ```yaml flow 块（非标准 ```flow），状态机以 YAML 描述。
   * 工厂 flows.mjs 解析的是标准 ```flow 块，与此不兼容。
   * 返回 null → FLOWS 的 impl 双向检查可见跳过（VC-12），不假阳性。
   * MedTrust 的流程合规由 check-meta-docs.mjs 的 FLOWS 段（payload 红线/dead_edge）守护。
   */
  stateHasWriter() { return null; },
  viaResolves() { return null; },

  // ── DEPLOY 三方对拍 ────────────────────────────────────────
  envSampleFile: '.env.example',
  envScanSurface: ['apps', 'packages'],
  envScanExts: ['.ts', '.tsx', '.mjs'],

  // ── ARCHITECTURE / DESIGN ──────────────────────────────────
  guardResolves(spec) {
    if (/评审把关|待配|未配|仅文档约束|人工/.test(spec)) return null;
    const path = String(spec).match(/`([^`]+\.(?:mjs|js|ts|sh|yml|yaml))`/);
    if (path) return existsSync(join(root, path[1]));
    return null;
  },
};
