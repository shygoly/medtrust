// 测试用平台模块:从 packages/wasm-algorithms 的入库产物读取,保证测试跑的是
// 真正会被签名分发的字节(而非另建一份)。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sm2 } from 'sm-crypto';
import { sm3BytesHex } from '../../sm3';
import { moduleSignaturePayload } from '../module-verifier';

export const PLATFORM_MODULE_PATH = resolve(
  __dirname,
  '../../../../../../packages/wasm-algorithms/build/disproportionality.wasm',
);

export const PLATFORM_MODULE_BYTES = new Uint8Array(
  readFileSync(PLATFORM_MODULE_PATH),
);

export const PLATFORM_MODULE_SM3 = sm3BytesHex(PLATFORM_MODULE_BYTES);

export const PLATFORM_MODULE_ANALYSIS_TYPE = 'disproportionality';

export interface TestCa {
  publicKey: string;
  privateKey: string;
  sign(bytes: Uint8Array): string;
}

export function newTestCa(): TestCa {
  const keypair = sm2.generateKeyPairHex();
  return {
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
    sign(bytes: Uint8Array): string {
      return sm2.doSignature(
        moduleSignaturePayload(sm3BytesHex(bytes)),
        keypair.privateKey,
      );
    },
  };
}
