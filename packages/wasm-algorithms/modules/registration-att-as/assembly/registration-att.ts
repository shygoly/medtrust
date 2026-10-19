// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors

// Registration external-control ATT kernel.
//
// Input rows are already aligned in the trusted node. Propensity scores and
// IPTW-ATT weights are prepared by the host TypeScript reference; this module
// performs the deterministic weighted risk contrast and returns aggregate-only
// values. No raw identifiers are accepted.
//
// ABI uses the existing causal-ate invocation shape:
//   run(inOff, n, k, outOff) -> i32; k must be 1.
// Input at inOff=0:
//   [n:i32][reserved 12 bytes][treated:u8[n]][outcome:u8[n]][pad]
//   [weightQ:i32[n]]
// Output:
//   riskTreatedQ, riskControlQ, riskDifferenceQ, riskRatioQ,
//   rdCiLowQ, rdCiHighQ, rrCiLowQ, rrCiHighQ: i32 (Q16.16)
//   effectiveSampleSize: f64
//   nTreated, nControl: i32

export const abi_version: i32 = 1;

const ROWS_OFF: i32 = 1024;
const Q: f64 = 65536.0;
const Z95: f64 = 1.959963984540054;

function q(value: f64): i32 {
  let scaled = value * Q;
  if (scaled > 2147483647.0) scaled = 2147483647.0;
  if (scaled < -2147483648.0) scaled = -2147483648.0;
  return <i32>Math.round(scaled);
}

// exp() for the small log-ratio intervals used here. A local series keeps the
// module deterministic and avoids relying on host math beyond basic operators.
function expSmall(value: f64): f64 {
  let term = 1.0;
  let sum = 1.0;
  for (let i = 1; i <= 12; i++) {
    term = term * value / <f64>i;
    sum += term;
  }
  return sum;
}

export function run(inOff: i32, n: i32, k: i32, outOff: i32): i32 {
  if (inOff < 0 || n < 1 || k !== 1 || outOff <= ROWS_OFF) return 5;
  const treatedOff = ROWS_OFF;
  const outcomeOff = treatedOff + n;
  const weightOff = (outcomeOff + n + 3) & ~3;

  let nT = 0;
  let nC = 0;
  let sumT = 0.0;
  let sumCY = 0.0;
  let sumW = 0.0;
  let sumW2 = 0.0;

  for (let i = 0; i < n; i++) {
    const t = <i32>load<u8>(treatedOff + i);
    const y = <i32>load<u8>(outcomeOff + i);
    if ((t !== 0 && t !== 1) || (y !== 0 && y !== 1)) return 5;
    if (t === 1) {
      nT++;
      sumT += <f64>y;
      continue;
    }
    const wq = load<i32>(weightOff + i * 4);
    if (wq < 1) return 5;
    const w = <f64>wq / Q;
    nC++;
    sumCY += <f64>y * w;
    sumW += w;
    sumW2 += w * w;
  }
  if (nT === 0 || nC === 0 || sumW <= 0.0) return 5;

  const riskTreated = sumT / <f64>nT;
  const riskControl = sumCY / sumW;
  const riskDifference = riskTreated - riskControl;
  if (riskControl <= 0.0) return 5;
  const riskRatio = riskTreated / riskControl;

  let squaredControl = 0.0;
  for (let i = 0; i < n; i++) {
    if (<i32>load<u8>(treatedOff + i) !== 0) continue;
    const y = <f64>load<u8>(outcomeOff + i);
    const w = <f64>load<i32>(weightOff + i * 4) / Q;
    squaredControl += w * w * (y - riskControl) * (y - riskControl);
  }
  const varT = riskTreated * (1.0 - riskTreated) / <f64>nT;
  const varC = squaredControl / (sumW * sumW);
  const seDiff = Math.sqrt(varT + varC);
  const seLog =
    Math.sqrt((1.0 - riskTreated) / (<f64>nT * riskTreated) + varC / (riskControl * riskControl));
  const eesControl = sumW * sumW / sumW2;

  const rrLow = q(riskRatio * expSmall(-Z95 * seLog));
  const rrHigh = q(riskRatio * expSmall(Z95 * seLog));
  store<i32>(outOff, q(riskTreated));
  store<i32>(outOff + 4, q(riskControl));
  store<i32>(outOff + 8, q(riskDifference));
  store<i32>(outOff + 12, q(riskRatio));
  store<i32>(outOff + 16, q(riskDifference - Z95 * seDiff));
  store<i32>(outOff + 20, q(riskDifference + Z95 * seDiff));
  store<i32>(outOff + 24, rrLow);
  store<i32>(outOff + 28, rrHigh);
  store<f64>(outOff + 40, <f64>nT + eesControl);
  store<i32>(outOff + 48, nT);
  store<i32>(outOff + 52, nC);
  return 0;
}
