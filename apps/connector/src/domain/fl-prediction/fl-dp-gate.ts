import { FlPredictionTaskSpec } from './fl-prediction-task-spec';
import { FlClassificationMetrics, FlPartyRunResult } from './fl-run-result';
import { FlOutputBlocked } from './fl-output-guard';

/** 确定性 Laplace 噪声(演示用; 生产由 connector-ml / SecretFlow DP-SGD 承担). */
function laplaceNoise(scale: number, seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const u = (Math.abs(h) % 9_999) / 10_000 + 0.0005;
  return -scale * Math.sign(u - 0.5) * Math.log(1 - 2 * Math.abs(u - 0.5));
}

/** 对 [0,1] 有界指标施加 Laplace 噪声并裁剪. */
export function applyDpToPartyMetrics(
  metrics: FlClassificationMetrics,
  epsilon: number,
  seed: string,
): FlClassificationMetrics {
  const scale = 1 / Math.max(epsilon, 0.1);
  const out: FlClassificationMetrics = { ...metrics };
  const keys: (keyof FlClassificationMetrics)[] = ['auc', 'f1', 'precision', 'recall', 'accuracy'];
  for (const key of keys) {
    const v = out[key];
    if (v === undefined) continue;
    const noisy = v + laplaceNoise(scale, `${seed}:${key}`);
    out[key] = Number(Math.max(0, Math.min(1, noisy)).toFixed(4));
  }
  return out;
}

/** 任务声明 ε 预算时, 未加噪的 party 结果禁止出域 (任务 6.2). */
export function assertDpCompliance(
  spec: FlPredictionTaskSpec,
  result: FlPartyRunResult,
): void {
  const epsilon = spec.privacy?.dpEpsilon;
  if (epsilon === undefined) return;
  if (!result.dpApplied) {
    throw new FlOutputBlocked('result.dpApplied');
  }
  if (result.dpEpsilon === undefined || result.dpEpsilon > epsilon + 1e-9) {
    throw new FlOutputBlocked('result.dpEpsilon');
  }
}

/** 在 mock / 本地路径上应用 DP 并标记 dpApplied. */
export function finalizePartyResultWithDp(
  spec: FlPredictionTaskSpec,
  result: FlPartyRunResult,
): FlPartyRunResult {
  const epsilon = spec.privacy?.dpEpsilon;
  if (epsilon === undefined) return result;
  return {
    ...result,
    localMetrics: applyDpToPartyMetrics(
      result.localMetrics,
      epsilon,
      `${result.taskId}:${result.participantId}`,
    ),
    dpApplied: true,
    dpEpsilon: epsilon,
  };
}
