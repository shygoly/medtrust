// 测试用平台模块:从 packages/wasm-algorithms 的入库产物读取,保证测试跑的是
// 真正会被签名分发的字节(而非另建一份)。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sm2 } from 'sm-crypto';
import { signSm2 } from '../../sm2-sign';
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
      // 与线上同口径：模块签名走国标 SM2（D-MDOP-3）。
      return signSm2(
        moduleSignaturePayload(sm3BytesHex(bytes)),
        keypair.privateKey,
        keypair.publicKey,
      );
    },
  };
}

// third-party-module-admission:Tier B 形态的 Rust 模块（平台从第三方源码复现构建）。
// 与上面的 AssemblyScript 模块**同一 ABI、同一语义**——闸 3 的一致性对拍正是
// 拿它跟独立参考实现逐字段比。清单由 scripts/admit-cli.mjs 登记。
import { existsSync } from 'node:fs';

const BUILD_DIR = resolve(
  __dirname,
  '../../../../../../packages/wasm-algorithms/build',
);

function rustModulePath(): string | null {
  const manifestPath = resolve(BUILD_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    modules: Array<{ file: string; language?: string; compiler?: { name: string } }>;
  };
  const entry = manifest.modules.find(
    (m) => m.language === 'rust' || m.compiler?.name === 'rust',
  );
  if (!entry) return null;
  const p = resolve(BUILD_DIR, entry.file);
  return existsSync(p) ? p : null;
}

const RUST_PATH = rustModulePath();

/** Tier B Rust 模块字节；未构建 Rust 工具链时为 null（用例自行 skip）。 */
export const TIER_B_MODULE_BYTES: Uint8Array | null = RUST_PATH
  ? new Uint8Array(readFileSync(RUST_PATH))
  : null;

export const TIER_B_MODULE_SM3: string | null = TIER_B_MODULE_BYTES
  ? sm3BytesHex(TIER_B_MODULE_BYTES)
  : null;
