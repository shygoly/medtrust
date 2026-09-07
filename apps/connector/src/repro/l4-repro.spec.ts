/**
 * L4-repro — RED 阶段（TDD Test 阶段）可复现性验收测试。
 *
 * Acceptance（任务卡 L4-repro）:
 *   A. 从原始数据执行一键重跑命令生成的关键指标与已发布结果完全一致或偏差<1%；
 *   B. CI/运行日志留存。
 * Gap:
 *   各层级输出依赖手工步骤，代码/数据/参数版本未固化，无法一键端到端重跑。
 *
 * 目标缺陷（均为断言级失败 is_assertion_failure=true）:
 *   1. 仓库根 package.json 未声明任何「一键重跑」命令
 *      （reproduce:l4 / l4:reproduce / rerun:l4 全缺失）——验收 A 的入口不存在。
 *   2. 不存在可从原始数据端到端重跑并产出重跑报告的命令
 *      （`pnpm reproduce:l4` 直接退出非 0，data/repro/repro-report.json 不存在）。
 *   3. 重跑报告缺失 → 关键指标（totalSubjects / 各站 trueEvents / codedEvents /
 *      L0 Se/Sp）无法与已发布结果 data/rws-test-data/answer-key.json 对拍，<1% 断言不可满足。
 *   4. .github/workflows/ 下没有运行重跑并留存运行日志的 CI 工作流
 *      （reproducibility.yml 缺失）——验收 B 未落地。
 *   5. 代码/数据/参数版本未固化：data/rws-test-data/repro-manifest.json 缺失，
 *      无法证明「同一版本输入 → 同一输出」。
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

// 本文件位于 apps/connector/src/repro/ → 仓库根 = ../../../../.
const ROOT = path.resolve(__dirname, '../../../../');

const REPRO_SCRIPT_CANDIDATES = ['reproduce:l4', 'l4:reproduce', 'rerun:l4'];
const REPRO_REPORT_PATH = path.join(ROOT, 'data/repro/repro-report.json');
const ANSWER_KEY_PATH = path.join(ROOT, 'data/rws-test-data/answer-key.json');
const CI_WORKFLOW_PATH = path.join(ROOT, '.github/workflows/reproducibility.yml');
const REPRO_MANIFEST_PATH = path.join(ROOT, 'data/rws-test-data/repro-manifest.json');

/** 相对偏差是否 < pct（默认 1%）——验收 A 的偏差阈值。 */
function withinPct(actual: number, expected: number, pct = 0.01): boolean {
  if (expected === 0) return actual === expected;
  return Math.abs(actual - expected) / Math.abs(expected) < pct;
}

function readAnswerKey(): {
  params: { codeSensitivity: number; codeSpecificity: number };
  totalSubjects: number;
  perSite: Record<string, { subjects: number; trueEvents: number; codedEvents: number }>;
} {
  return JSON.parse(fs.readFileSync(ANSWER_KEY_PATH, 'utf-8')) as ReturnType<
    typeof readAnswerKey
  >;
}

describe('L4-repro — 一键端到端重跑可复现性验收', () => {
  it('L4-REPRO-1a 声明一键重跑命令：package.json 至少含一个 reproduce:l4 脚本', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const scripts = (rootPkg.scripts ?? {}) as Record<string, string>;
    const found = REPRO_SCRIPT_CANDIDATES.filter((s) => typeof scripts[s] === 'string');
    // 验收 A 的前提：存在一条可执行的一键重跑命令。当前仓库没有任何该命令。
    expect(found.length).toBeGreaterThan(0);
  });

  it('L4-REPRO-1b 一键重跑命令从原始数据端到端执行成功并产出重跑报告', () => {
    const res = spawnSync('pnpm', ['reproduce:l4'], {
      cwd: ROOT,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    const status = res.status ?? 1;
    // 命令未实现（或 pnpm 不可用）→ 非 0 退出。实现后须 exit 0。
    expect(status).toBe(0);
    // 命令必须产出机器可读的重跑报告，供 CI/审计留存与对拍。
    expect(fs.existsSync(REPRO_REPORT_PATH)).toBe(true);
  });

  it('L4-REPRO-2 重跑报告关键指标与已发布结果完全一致或偏差<1%', () => {
    // 重跑报告是「一键重跑命令」的产物；报告缺失 ⇒ 对拍无从谈起（断言级失败）。
    expect(fs.existsSync(REPRO_REPORT_PATH)).toBe(true);
    if (!fs.existsSync(REPRO_REPORT_PATH)) return;

    const report = JSON.parse(fs.readFileSync(REPRO_REPORT_PATH, 'utf-8')) as {
      keyMetrics: {
        totalSubjects: number;
        perSite: Record<
          string,
          { subjects: number; trueEvents: number; codedEvents: number }
        >;
        l0Sensitivity: number;
        l0Specificity: number;
      };
      versions: { code: string; dataSeed: number; params: string };
    };
    const answerKey = readAnswerKey();

    // 规模：完全一致（整数计数）。
    expect(report.keyMetrics.totalSubjects).toBe(answerKey.totalSubjects);
    for (const site of Object.keys(answerKey.perSite)) {
      expect(report.keyMetrics.perSite[site].subjects).toBe(
        answerKey.perSite[site].subjects,
      );
      expect(report.keyMetrics.perSite[site].trueEvents).toBe(
        answerKey.perSite[site].trueEvents,
      );
      expect(report.keyMetrics.perSite[site].codedEvents).toBe(
        answerKey.perSite[site].codedEvents,
      );
    }
    // L0 Se/Sp 与注入真值（已发布结果）偏差 < 1%。
    expect(
      withinPct(report.keyMetrics.l0Sensitivity, answerKey.params.codeSensitivity),
    ).toBe(true);
    expect(
      withinPct(report.keyMetrics.l0Specificity, answerKey.params.codeSpecificity),
    ).toBe(true);
  });

  it('L4-REPRO-3 CI 工作流运行一键重跑并留存运行日志', () => {
    // 验收 B：必须有 CI 工作流执行重跑，并把运行日志作为 artifact 留存。
    expect(fs.existsSync(CI_WORKFLOW_PATH)).toBe(true);
    if (!fs.existsSync(CI_WORKFLOW_PATH)) return;

    const wf = fs.readFileSync(CI_WORKFLOW_PATH, 'utf-8');
    expect(wf).toContain('reproduce:l4'); // CI 调用一键重跑命令
    expect(wf).toContain('upload-artifact'); // 日志/报告留存在 CI 产物中
  });

  it('L4-REPRO-4 代码/数据/参数版本固化清单存在（可复现性基线）', () => {
    // 验收 A/B 的根基：重跑所用代码版本、数据 seed、参数版本必须固化并留痕。
    expect(fs.existsSync(REPRO_MANIFEST_PATH)).toBe(true);
    if (!fs.existsSync(REPRO_MANIFEST_PATH)) return;

    const manifest = JSON.parse(
      fs.readFileSync(REPRO_MANIFEST_PATH, 'utf-8'),
    ) as { codeVersion?: string; dataSeed?: number; paramsVersion?: string };
    expect(manifest).toHaveProperty('codeVersion');
    expect(manifest).toHaveProperty('dataSeed');
    expect(manifest).toHaveProperty('paramsVersion');
    expect(typeof manifest.codeVersion).toBe('string');
    expect(typeof manifest.paramsVersion).toBe('string');
  });
});
