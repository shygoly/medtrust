import { gateKmCurve } from './km-gate';
import type { KmCurvePayload } from './types';

describe('gateKmCurve', () => {
  it('suppresses tail bins when atRisk < threshold', () => {
    const bins: KmCurvePayload = {
      binWidthDays: 30,
      bins: [
        { t: 0, survival: 1, atRisk: 100 },
        { t: 360, survival: 0.7, atRisk: 3 },
      ],
    };
    const out = gateKmCurve(bins, 5);
    expect(out.bins[1].suppressed).toBe(true);
    expect(out.bins[1].atRisk).toBe(0);
    expect(out.bins[1].survival).toBe(0);
  });

  it('leaves bins with sufficient at-risk untouched', () => {
    const bins: KmCurvePayload = {
      binWidthDays: 30,
      bins: [{ t: 0, survival: 1, atRisk: 50 }],
    };
    const out = gateKmCurve(bins, 5);
    expect(out.bins[0].suppressed).toBeUndefined();
    expect(out.bins[0].atRisk).toBe(50);
  });
});
