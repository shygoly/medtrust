// algorithm-sandbox / third-party-module-admission — 算法模块运行前校验。
//
// 1) **吊销检查**(闸 5):模块在吊销名单里即拒,且不回退到内置实现;
// 2) 模块字节的 SM3 必须等于数字合约为该分析类型固定的 SM3(院方批准的是这一份代码);
// 3) 模块的 SM2 签名必须能用部署配置里固定的**注册中心公钥**验证通过(平台审计背书;
//    它就是 P-CTL-6 的「专用算法签名密钥」，与 CA 根钥按用途分离 —— D-MDOP-3);
// 4) **闸 1 静态白名单**(@medtrust/wasm-algorithms):import/export/特性/上限,
//    与平台侧准入**同一份实现** —— 两端各写一份必然漂移,漂移即准入闸形同虚设。
//
// 任一失败即拒绝执行 —— **不回退到内置 TS 实现**(D-UC-2 fail-closed)。
// 注册中心公钥只从部署配置(CONNECTOR_REGISTRY_PUBKEY)读取,不从控制面任务通道取,
// 避免控制面被攻破时连模块带公钥一起伪造(design D5)。
import { verifySm2 } from '../sm2-sign';
import {
  ModuleRevokedError,
  StaticGateError,
  assertNotRevoked,
  staticGate,
  type RevocationList,
  type StaticGateLimits,
  type StaticGateReport,
} from '@medtrust/wasm-algorithms';
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
      | 'no-registry-pubkey'
      | 'static-gate'
      | 'revoked',
  ) {
    super(message);
    this.name = 'ModuleVerificationError';
  }
}

/** 闸 1 原因码 → 既有审计原因码的映射(其余归 static-gate)。 */
const STATIC_GATE_REASON_MAP: Partial<
  Record<string, ModuleVerificationError['reason']>
> = {
  'illegal-import': 'illegal-import',
  'illegal-export': 'illegal-export',
};

export interface ModuleDescriptor {
  analysisType: string;
  sm3: string;
  signature: string;
  abiVersion: number;
}

export interface VerifiedModule extends ModuleDescriptor {
  module: WebAssembly.Module;
  /** 闸 1 报告（含 abi_version 的导出形态，worker 据此读取）。 */
  gate: StaticGateReport;
}

export interface VerifyOptions {
  /** 合约固定的模块 SM3(小写 64 hex)。 */
  expectedSm3: string;
  /** 注册中心密钥对模块 SM3 的国标 SM2 签名。 */
  signature: string;
  /**
   * 部署固定的**注册中心公钥**（CONNECTOR_REGISTRY_PUBKEY，不从任务通道获取）。
   * 签名口径为国标 SM2（Z_A + DER）。
   */
  registryPublicKey: string;
  analysisType: string;
  /** 闸 5:平台下发的吊销名单（缺省 = 本次未拿到名单）。 */
  revocationList?: RevocationList;
  /** 闸 1 上限（字节数 / 内存页数），缺省取包内默认。 */
  staticLimits?: StaticGateLimits;
}

/**
 * 双重校验 + 零能力实例化前检查。
 * 只做静态检查(编译 + 导入/导出/ABI),不实例化、不调用 run —— 调用发生在 worker 内。
 */
export function verifyModule(
  bytes: Uint8Array,
  opts: VerifyOptions,
): VerifiedModule {
  // 0) 吊销检查 —— 排在最前:已吊销的模块连校验都不必做,当场拒。
  try {
    assertNotRevoked(opts.revocationList, opts.expectedSm3 ?? '');
  } catch (err) {
    if (err instanceof ModuleRevokedError) {
      throw new ModuleVerificationError(err.message, 'revoked');
    }
    throw err;
  }

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
  const registryPublicKey = opts.registryPublicKey?.trim();
  if (!registryPublicKey) {
    throw new ModuleVerificationError(
      '未配置 CONNECTOR_REGISTRY_PUBKEY,无法验证模块签名 —— 拒绝执行(fail-closed)',
      'no-registry-pubkey',
    );
  }
  // 线上链路只接受国标口径（Z_A + DER）；旧格式一律拒（防降级）。
  const signatureOk = verifySm2(
    moduleSignaturePayload(actual),
    opts.signature,
    registryPublicKey,
  );
  if (!signatureOk) {
    throw new ModuleVerificationError(
      `模块 SM2 签名验证失败(非注册中心密钥签发或模块被篡改),sm3=${actual}`,
      'signature-invalid',
    );
  }

  // 3) 闸 1 静态白名单(共享实现):import / export / 特性 / 上限。
  //    在编译之前跑 —— 连 WebAssembly.Module 构造都不给畸形模块机会。
  let gate: StaticGateReport;
  try {
    gate = staticGate(bytes, opts.staticLimits);
  } catch (err) {
    if (err instanceof StaticGateError) {
      // 审计原因码是治理可见面(CTL-20/CTL-24 按原因归类),
      // 所以保留 illegal-import / illegal-export 这两个既有分类,
      // 其余闸 1 判据(特性/上限/start 段/畸形)统一归 static-gate。
      throw new ModuleVerificationError(
        `静态白名单校验失败[${err.reason}]:${err.message}`,
        STATIC_GATE_REASON_MAP[err.reason] ?? 'static-gate',
      );
    }
    throw err;
  }

  // 4) 编译(到这一步模块的能力面已被闸 1 收窄;编译失败同样拒)。
  let module: WebAssembly.Module;
  try {
    module = new WebAssembly.Module(toArrayBuffer(bytes));
  } catch (err) {
    throw new ModuleVerificationError(
      `模块编译失败:${(err as Error).message}`,
      'compile-failed',
    );
  }

  return {
    analysisType: opts.analysisType,
    sm3: actual,
    signature: opts.signature,
    abiVersion: -1, // 由 worker 实例化后读出真实值并校验
    module,
    gate,
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
