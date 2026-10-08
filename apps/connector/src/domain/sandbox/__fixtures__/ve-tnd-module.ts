// 测试用**疫苗保护效果（TND）模块**：从 packages/wasm-algorithms 的入库产物读取，
// 保证测试跑的是真正会被签名分发的字节（而不是另建一份）。与 distinct-count-module.ts 同一口径。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sm3BytesHex } from '../../sm3';

export const VE_TND_MODULE_PATH = resolve(
  __dirname,
  '../../../../../../packages/wasm-algorithms/build/ve-tnd.wasm',
);

export const VE_TND_MODULE_BYTES = new Uint8Array(readFileSync(VE_TND_MODULE_PATH));

export const VE_TND_MODULE_SM3 = sm3BytesHex(VE_TND_MODULE_BYTES);

export const VE_TND_MODULE_ANALYSIS_TYPE = 've-tnd';
