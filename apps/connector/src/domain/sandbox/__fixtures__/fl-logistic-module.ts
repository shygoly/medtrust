// 测试用 L4 模块：从 packages/wasm-algorithms 的入库产物读取（真会被签名分发的字节）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sm3BytesHex } from '../../sm3';

export const FL_LOGISTIC_MODULE_PATH = resolve(
  __dirname,
  '../../../../../../packages/wasm-algorithms/build/fl-logistic.wasm',
);

export const FL_LOGISTIC_MODULE_BYTES = new Uint8Array(
  readFileSync(FL_LOGISTIC_MODULE_PATH),
);

export const FL_LOGISTIC_MODULE_SM3 = sm3BytesHex(FL_LOGISTIC_MODULE_BYTES);

export const FL_LOGISTIC_ANALYSIS_TYPE = 'fl-logistic';
