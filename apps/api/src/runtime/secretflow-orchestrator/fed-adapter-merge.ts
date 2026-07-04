import { createHash } from 'crypto';

export type AdapterTensor = {
  shape: number[];
  data: string; // base64 float32 LE
};

export type AdapterState = Record<string, AdapterTensor>;

export type WeightedDelta = {
  participantId: string;
  delta: AdapterState;
  weight: number;
  localLoss: number;
};

function tensorFromBase64(shape: number[], data: string): Float32Array {
  const buf = Buffer.from(data, 'base64');
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  if (arr.length !== shape.reduce((a, b) => a * b, 1)) {
    throw new Error(`adapter tensor shape mismatch for ${shape.join('x')}`);
  }
  return arr;
}

function tensorToBase64(values: Float32Array): string {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64');
}

export function decodeAdapter(json: string): AdapterState {
  if (!json) return {};
  const payload = JSON.parse(json) as AdapterState;
  return payload;
}

export function encodeAdapter(state: AdapterState): string {
  return JSON.stringify(state);
}

export function applyFedAvgDeltas(
  globalAdapter: AdapterState | null,
  rounds: WeightedDelta[],
): AdapterState {
  if (!rounds.length) {
    throw new Error('no adapter deltas to aggregate');
  }
  const keys = Object.keys(rounds[0].delta).sort();
  const totalWeight = rounds.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) {
    throw new Error('zero sample weight in FedAvg merge');
  }

  const out: AdapterState = {};
  for (const key of keys) {
    const shape = rounds[0].delta[key].shape;
    const size = shape.reduce((a, b) => a * b, 1);
    let base: Float32Array;
    if (globalAdapter?.[key]) {
      base = Float32Array.from(
        tensorFromBase64(globalAdapter[key].shape, globalAdapter[key].data),
      );
    } else {
      base = new Float32Array(size);
    }
    const acc = new Float32Array(size);
    for (const round of rounds) {
      const delta = tensorFromBase64(round.delta[key].shape, round.delta[key].data);
      const w = round.weight / totalWeight;
      for (let i = 0; i < size; i += 1) {
        acc[i] += delta[i] * w;
      }
    }
    const merged = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      merged[i] = base[i] + acc[i];
    }
    out[key] = { shape, data: tensorToBase64(merged) };
  }
  return out;
}

/** Match Python output_guard._adapter_fingerprint (rounded float32 concat). */
export function adapterFingerprint(state: AdapterState): string {
  const keys = Object.keys(state).sort();
  const chunks: Buffer[] = [];
  for (const key of keys) {
    const values = tensorFromBase64(state[key].shape, state[key].data);
    const rounded = Float32Array.from(values, (v) => Math.round(v * 1e4) / 1e4);
    chunks.push(Buffer.from(rounded.buffer, rounded.byteOffset, rounded.byteLength));
  }
  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}

export function loraHashFromAdapter(state: AdapterState): string {
  return `LORA:${adapterFingerprint(state).slice(0, 16)}`;
}
