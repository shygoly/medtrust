import { ConfusionMatrix, MetricWithCi, ValidationMetrics } from '../types';

// 95% confidence intervals via Wilson score interval.
//
// Why Wilson (rws-algorithm-validation D2 / DOMAIN.md 派生公式区):
//   - Validation studies have small samples (chart review is expensive).
//   - Wald (point ± 1.96·se) is degenerate near p=0 or p=1: the interval can
//     go below 0 or above 1, which is meaningless for a proportion. High-Sp
//     algorithms (Sp → 1) are the COMMON case here — Wald would report
//     "Sp upper bound > 1", an obvious lie.
//   - Wilson is bounded in [0,1] and well-behaved at the extremes.
//   - Clopper-Pearson is more conservative; we keep it out of the default
//     path to avoid systematically over-wide intervals that understate
//     algorithm quality. (Open Question in design.md.)
//
// Formula (standard, z=1.959963984540054 for 95% two-sided):
//   center = (p + z²/(2n)) / (1 + z²/n)
//   half   = (z·sqrt(p(1-p)/n + z²/(4n²))) / (1 + z²/n)
//   lo = center - half,  hi = center + half
// All clipped to [0, 1].

export const Z_975 = 1.959963984540054; // z_{0.975}

/**
 * Wilson score 95% CI for a binomial proportion.
 * @param k successes  @param n trials  (n must be > 0)
 */
export function wilsonScoreInterval(k: number, n: number): [number, number] {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const z2 = Z_975 * Z_975;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half =
    (Z_975 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lo = Math.max(0, center - half);
  const hi = Math.min(1, center + half);
  // Clamp tiny floating-point residue to exact 0/1 (Wilson at k=0 is
  // mathematically 0 but FP arithmetic leaves ~1e-18).
  const cleanLo = lo < 1e-15 ? 0 : lo;
  const cleanHi = hi > 1 - 1e-15 ? 1 : hi;
  return [cleanLo, cleanHi];
}

/** Wilson CI on a proportion expressed directly (k/n). */
function metric(k: number, n: number): MetricWithCi {
  if (n <= 0) {
    // Degenerate denominator: report point 0 with empty CI. The output gate
    // suppresses results with any cell below threshold before this is ever
    // called on a real result, but guard anyway.
    return { point: 0, ci95: [0, 0] };
  }
  return { point: k / n, ci95: wilsonScoreInterval(k, n) };
}

/**
 * Derive Se / Sp / PPV / NPV from a confusion matrix.
 *
 * Definitions (DOMAIN.md 派生公式区 is the single source of truth):
 *   Se  = TP / (TP + FN)
 *   Sp  = TN / (TN + FP)
 *   PPV = TP / (TP + FP)
 *   NPV = TN / (TN + FN)
 */
export function metricsFromConfusionMatrix(cm: ConfusionMatrix): ValidationMetrics {
  return {
    sensitivity: metric(cm.tp, cm.tp + cm.fn),
    specificity: metric(cm.tn, cm.tn + cm.fp),
    ppv: metric(cm.tp, cm.tp + cm.fp),
    npv: metric(cm.tn, cm.tn + cm.fn),
  };
}
