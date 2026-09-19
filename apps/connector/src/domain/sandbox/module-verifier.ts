// algorithm-sandbox — 算法模块运行前双重校验(design D5)。
//
// 1) 模块字节的 SM3 必须等于数字合约为该分析类型固定的 SM3(院方批准的是这一份代码);
// 2) 模块的 SM2 签名必须能用部署配置里固定的平台 CA 公钥验证通过(平台审计背书)。
//
// 两项缺一不可,任一失败即拒绝执行 —— **不回退到内置 TS 实现**(D-UC-2 fail-closed)。
// 平台公钥只从部署配置(CONNECTOR_PLATFORM_CA_PUBKEY)读取,不从控制面任务通道取,
// 避免控制面被攻破时连模块带公钥一起伪造(design D5)。
import { sm2 } from 'sm-crypto';
import { sm3BytesHex } from '../sm3';

/** 模块签名载荷格式。平台侧签发与连接器侧验签必须使用同一串(改动须双端同步)。 */
export const MODULE_SIGNATURE_PAYLOAD_PREFIX = 'medtrust.algorithm-module.v1:';

export function moduleSignaturePayload(sm3: string): string {
  return `${MODULE_SIGNATURE_PAYLOAD_PREFIX}${sm3.toLowerCase()}`;
}

/** 连接器支持的 ABI 版本。不在此集合内一律拒绝。 */
export const SUPPORTED_ABI_VERSIONS = [1] as const;

export class ModuleVerificationError extends Error {
  constructor(
    message: string,
    /** 供审计归类的原因码。 */
    readonly reason:
      | 'sm3-mismatch'
      | 'signature-invalid'
      | 'illegal-import'
      | 'illegal-export'
      | 'abi-unsupported'
      | 'compile-failed'
      | 'no-platform-ca-pubkey',
  ) {
    super(message);
    this.name = 'ModuleVerificationError';
  }
}

export interface ModuleDescriptor {
  analysisType: string;
  sm3: string;
  signature: string;
  abiVersion: number;
}

export interface VerifiedModule extends ModuleDescriptor {
  module: WebAssembly.Module;
}

export interface VerifyOptions {
  /** 合约固定的模块 SM3(小写 64 hex)。 */
  expectedSm3: string;
  /** 平台 CA 对模块 SM3 的 SM2 签名。 */
  signature: string;
  /** 部署固定的平台 CA 公钥(不从任务通道获取)。 */
  platformCaPublicKey: string;
  analysisType: string;
}

/**
 * 双重校验 + 零能力实例化前检查。
 * 只做静态检查(编译 + 导入/导出/ABI),不实例化、不调用 run —— 调用发生在 worker 内。
 */
export function verifyModule(
  bytes: Uint8Array,
  opts: VerifyOptions,
): VerifiedModule {
  const expected = (opts.expectedSm3 ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new ModuleVerificationError(
      `合约固定的模块 SM3 非法(须为 64 hex 小写):${opts.expectedSm3}`,
      'sm3-mismatch',
    );
  }

  // 1) SM3 与合约固定值比对
  const actual = sm3BytesHex(bytes);
  if (actual !== expected) {
    throw new ModuleVerificationError(
      `模块 SM3 与合约固定值不符:实际 ${actual} ≠ 合约 ${expected}`,
      'sm3-mismatch',
    );
  }

  // 2) SM2 验签(部署固定的平台 CA 公钥)
  const caPublicKey = opts.platformCaPublicKey?.trim();
  if (!caPublicKey) {
    throw new ModuleVerificationError(
      '未配置 CONNECTOR_PLATFORM_CA_PUBKEY,无法验证模块签名 —— 拒绝执行(fail-closed)',
      'no-platform-ca-pubkey',
    );
  }
  let signatureOk = false;
  try {
    signatureOk = sm2.doVerifySignature(
      moduleSignaturePayload(actual),
      opts.signature,
      caPublicKey,
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    throw new ModuleVerificationError(
      `模块 SM2 签名验证失败(非该平台 CA 签发或模块被篡改),sm3=${actual}`,
      'signature-invalid',
    );
  }

  // 3) 零能力实例化前检查:导入只看得到一块宿主提供的内存
  let module: WebAssembly.Module;
  try {
    module = new WebAssembly.Module(toArrayBuffer(bytes));
  } catch (err) {
    throw new ModuleVerificationError(
      `模块编译失败:${(err as Error).message}`,
      'compile-failed',
    );
  }
  const imports = WebAssembly.Module.imports(module);
  if (
    imports.length !== 1 ||
    imports[0].module !== 'env' ||
    imports[0].name !== 'memory' ||
    imports[0].kind !== 'memory'
  ) {
    const detail = imports
      .map((i) => `${i.module}.${i.name}(${i.kind})`)
      .join(', ');
    throw new ModuleVerificationError(
      `模块含非零能力导入(只允许 env.memory):${detail || '无导入'}`,
      'illegal-import',
    );
  }

  const exports = WebAssembly.Module.exports(module);
  const run = exports.find((e) => e.name === 'run');
  if (!run || run.kind !== 'function') {
    throw new ModuleVerificationError(
      '模块未导出 run 函数',
      'illegal-export',
    );
  }
  const abi = exports.find((e) => e.name === 'abi_version');
  if (!abi || abi.kind !== 'global') {
    throw new ModuleVerificationError(
      '模块未导出常量全局 abi_version',
      'illegal-export',
    );
  }
  const unexpected = exports.find(
    (e) => !['run', 'abi_version', 'memory'].includes(e.name),
  );
  if (unexpected) {
    throw new ModuleVerificationError(
      `模块导出了未授权符号 ${unexpected.name}(${unexpected.kind})`,
      'illegal-export',
    );
  }

  return {
    analysisType: opts.analysisType,
    sm3: actual,
    signature: opts.signature,
    abiVersion: -1, // 由 worker 实例化后读出真实值并校验
    module,
  };
}

/** 复制成独立的 ArrayBuffer —— WebAssembly 构造器要求 BufferSource<ArrayBuffer>。 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** worker 报告回来的 ABI 版本校验(实例化后才能读到全局量)。 */
export function assertSupportedAbi(abiVersion: number): void {
  if (!SUPPORTED_ABI_VERSIONS.includes(abiVersion as 1)) {
    throw new ModuleVerificationError(
      `模块 abi_version=${abiVersion} 不受支持(支持:${SUPPORTED_ABI_VERSIONS.join(',')})`,
      'abi-unsupported',
    );
  }
}
