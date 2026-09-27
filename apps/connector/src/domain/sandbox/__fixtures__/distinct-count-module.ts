// 测试用**去重人数模块**：从 packages/wasm-algorithms 的入库产物读取，保证测试跑的是
// 真正会被签名分发的字节（而不是另建一份）。与 pairing-module.ts 同一口径。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sm3BytesHex } from '../../sm3';

export const DISTINCT_COUNT_MODULE_PATH = resolve(
  __dirname,
  '../../../../../../packages/wasm-algorithms/build/distinct-count.wasm',
);

export const DISTINCT_COUNT_MODULE_BYTES = new Uint8Array(readFileSync(DISTINCT_COUNT_MODULE_PATH));

export const DISTINCT_COUNT_MODULE_SM3 = sm3BytesHex(DISTINCT_COUNT_MODULE_BYTES);

export const DISTINCT_COUNT_MODULE_ANALYSIS_TYPE = 'distinct-count';
