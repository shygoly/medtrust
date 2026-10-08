// 测试用**跨院去重发病率模块**：从 packages/wasm-algorithms 的入库产物读取，
// 保证测试跑的是真正会被签名分发的字节（而不是另建一份）。与 distinct-count-module.ts 同一口径。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sm3BytesHex } from '../../sm3';

export const DEDUP_INCIDENCE_MODULE_PATH = resolve(
  __dirname,
  '../../../../../../packages/wasm-algorithms/build/dedup-incidence.wasm',
);

export const DEDUP_INCIDENCE_MODULE_BYTES = new Uint8Array(
  readFileSync(DEDUP_INCIDENCE_MODULE_PATH),
);

export const DEDUP_INCIDENCE_MODULE_SM3 = sm3BytesHex(DEDUP_INCIDENCE_MODULE_BYTES);

export const DEDUP_INCIDENCE_MODULE_ANALYSIS_TYPE = 'dedup-incidence';
