import {
  applyFedAvgDeltas,
  decodeAdapter,
  loraHashFromAdapter,
  type AdapterState,
  type WeightedDelta,
} from "./fed-adapter-merge";

describe("fed-adapter-merge", () => {
  const sample: AdapterState = {
    "head.lora_A": {
      shape: [2, 2],
      data: Buffer.from(new Float32Array([0, 0, 0, 0]).buffer).toString(
        "base64",
      ),
    },
    "head.lora_B": {
      shape: [2, 2],
      data: Buffer.from(new Float32Array([0, 0, 0, 0]).buffer).toString(
        "base64",
      ),
    },
  };

  it("aggregates weighted deltas onto a global adapter", () => {
    const deltaJson = encodeDelta({
      "head.lora_A": f32([1, 0, 0, 0]),
      "head.lora_B": f32([0, 0, 0, 0]),
    });
    const merged = applyFedAvgDeltas(sample, [
      {
        participantId: "a",
        delta: decodeAdapter(deltaJson),
        weight: 2,
        localLoss: 1.2,
      },
      {
        participantId: "b",
        delta: decodeAdapter(deltaJson),
        weight: 2,
        localLoss: 1.1,
      },
    ]);
    const values = tensorValues(merged["head.lora_A"]);
    expect(values[0]).toBeCloseTo(1, 5);
  });

  it("produces stable LORA hash prefix", () => {
    const hash = loraHashFromAdapter(sample);
    expect(hash.startsWith("LORA:")).toBe(true);
    expect(hash.length).toBe(21);
  });
});

function f32(values: number[]) {
  return {
    shape: [2, 2],
    data: Buffer.from(new Float32Array(values).buffer).toString("base64"),
  };
}

function encodeDelta(delta: AdapterState): string {
  return JSON.stringify(delta);
}

function tensorValues(t: { shape: number[]; data: string }): Float32Array {
  const buf = Buffer.from(t.data, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
