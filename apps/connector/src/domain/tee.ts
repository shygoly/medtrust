import { Injectable, Optional } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { AuditService } from './audit';
import { sm3Hex } from './sm3';

export interface SealedInput {
  iv: string;
  ciphertext: string;
  tag: string;
}

export interface TeeAttestation {
  enclave: string;
  // 被执行代码的度量。software 级 = 分析函数源码的 SM3("sm3:<64hex>"),
  // 只说明"跑的是哪段代码",不是硬件签发的 MRENCLAVE,不能向远端证明任何事。
  measurement: string;
  level: 'software' | 'hardware'; // D9/D-RWS-4: 硬件远程证明接入前只能是 software
  // 数据在计算中是否与宿主隔离。software 级恒为 none(CTL-09 如实标注)。
  isolation: 'none' | 'hardware-enclave';
}

export interface TeeResult<O> {
  output: O;
  attestation: TeeAttestation;
}

// 可插拔 TEE 抽象 (D9)。目标是硬件飞地(海光 CSV):数据密封进入、在飞地内解密计算、
// 只带着输出 + 硬件远程证明离开。调用方按这份契约编码,换硬件实现时不必改动。
export interface TeeEnclave {
  seal(data: unknown): SealedInput;
  run<O>(sealed: SealedInput, fn: (data: any) => O): TeeResult<O>;
}

/**
 * 生产判据（与 `tee-node/config.ts` 对齐）：`NODE_ENV` 去空白、小写后等于 `production`。
 * 当前 Fly 连接器镜像刻意 `NODE_ENV=development`（演示），不会误伤；真生产必须设 production。
 */
export function isProductionNodeEnv(env: string | undefined = process.env.NODE_ENV): boolean {
  return (env ?? '').trim().toLowerCase() === 'production';
}

export const SOFTWARE_SEALED_COMPUTE_PRODUCTION_FORBIDDEN =
  'SoftwareSealedCompute 不可在生产环境实例化：软件实现无隔离、无远程证明，不得作为 C2 目标（D9 / CTL-09）。沙箱 ≠ TEE（D-CN-2）。';

/** 软件实现只许开发/测试。生产构造即失败——默认参数 `= new SoftwareSealedCompute()` 同样走这里，不可能静默生效。 */
export function assertSoftwareSealedComputeAllowed(env: string | undefined = process.env.NODE_ENV): void {
  if (isProductionNodeEnv(env)) {
    throw new Error(SOFTWARE_SEALED_COMPUTE_PRODUCTION_FORBIDDEN);
  }
}

// 软件实现 —— 如实说明(D9 / D-CN-2 / CTL-09):它不提供任何隔离或保密性。
// seal 与 run 在同一个 Node 进程里用同一把进程内密钥加密又解密,明文此前已在该进程内存中,
// 宿主与运维照样可读;也没有远程证明。保留这个类只为让调用点与硬件飞地契约保持一致。
// 每次运行的证明写入连接器本地审计,供院方核对"哪段代码、在什么保障级别下碰过数据"。
@Injectable()
export class SoftwareSealedCompute implements TeeEnclave {
  private readonly key = randomBytes(32); // 进程内密钥(非硬件保护)
  readonly enclaveId = 'sw-tee-' + randomBytes(4).toString('hex');

  constructor(@Optional() private readonly audit?: AuditService) {
    assertSoftwareSealedComputeAllowed();
  }

  seal(data: unknown): SealedInput {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return { iv: iv.toString('hex'), ciphertext: ct.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
  }

  run<O>(sealed: SealedInput, fn: (data: any) => O): TeeResult<O> {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(sealed.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    const output = fn(JSON.parse(plain)); // 同进程计算,无隔离
    const attestation: TeeAttestation = {
      enclave: this.enclaveId,
      measurement: 'sm3:' + sm3Hex(fn.toString()),
      level: 'software',
      isolation: 'none',
    };
    this.audit?.record({
      action: 'tee-run',
      actor: 'software-tee',
      allowed: true,
      detail: `level=${attestation.level} isolation=${attestation.isolation} measurement=${attestation.measurement} enclave=${attestation.enclave}`,
    });
    return { output, attestation };
  }
}
