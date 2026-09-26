// algorithm-sandbox — 算法模块注册表(design D6)。
//
// 启动时从 `packages/wasm-algorithms/build`(入库产物 + 清单)装载模块:校验
// 文件 SM3 与清单一致、ABI 在支持集合内,然后用平台 CA 对 **模块 SM3** 做 SM2 签名。
// 连接器按 SM3 拉取模块字节 + 签名,并用部署配置里固定的平台 CA 公钥验签。
//
// 签名载荷口径(`medtrust.algorithm-module.v1:<sm3>`)必须与连接器
// apps/connector/src/domain/sandbox/module-verifier.ts 的 moduleSignaturePayload 一致。
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GMCryptoService } from "../../security/crypto/gm-crypto.service";
import { CaService } from "../participant-identity/ca.service";

/** 控制面支持的模块 ABI 版本(与连接器 SUPPORTED_ABI_VERSIONS 同步)。 */
export const SUPPORTED_ABI_VERSIONS = [1];

export interface AlgorithmModuleManifest {
  analysisType: string;
  file: string;
  abiVersion: number;
  sm3: string;
  sizeBytes?: number;
  compiler?: { name: string; version: string };
  /**
   * 算子**声明形状**（平台模块在构建清单里给出；缺省表示按默认形状登记）。
   *
   * 为什么要有它：登记服务原先对每个 wasm 模块套同一份默认（`local`/`plain`/C0→table），
   * 于是「节点内协同类算子」（如跨院主体配对：输入 C2、只在 TEE 环境执行）
   * 会被冒充成连接器本地统计算子，编译器就可能把它放到医院侧。
   */
  operator?: {
    id: string;
    version: string;
    category: string;
    environments: string[];
    inputs: Array<{ name: string; schema: string; accept_labels: string[] }>;
    outputs: Array<{ name: string; schema: string; label_rule: string }>;
  };
}

export interface RegisteredAlgorithmModule extends AlgorithmModuleManifest {
  bytes: Buffer;
}

export interface DistributedAlgorithmModule extends AlgorithmModuleManifest {
  bytesBase64: string;
  signature: string;
}

/** 模块产物目录:环境变量优先,否则按仓库布局定位(dev/dist 同层数)。 */
export function resolveAlgorithmModuleDir(): string {
  const fromEnv = process.env.WASM_ALGORITHMS_DIR?.trim();
  if (fromEnv) return fromEnv;
  return resolve(__dirname, "../../../../../packages/wasm-algorithms/build");
}

@Injectable()
export class AlgorithmModuleRegistry implements OnModuleInit {
  private readonly logger = new Logger(AlgorithmModuleRegistry.name);
  private readonly modules = new Map<string, RegisteredAlgorithmModule>();
  private readonly signatures = new Map<string, string>();

  constructor(
    private readonly gm: GMCryptoService,
    private readonly ca: CaService,
  ) {}

  onModuleInit(): void {
    const dir = resolveAlgorithmModuleDir();
    const manifestPath = resolve(dir, "manifest.json");
    if (!existsSync(manifestPath)) {
      // 不阻塞启动:没有模块 → 合约无法固定模块(固定接口会拒绝),连接器拉不到模块。
      this.logger.warn(
        `算法模块清单不存在,注册表为空(fail-closed): ${manifestPath}`,
      );
      return;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      modules: AlgorithmModuleManifest[];
    };
    for (const entry of manifest.modules ?? []) {
      const filePath = resolve(dir, entry.file);
      if (!existsSync(filePath)) {
        this.logger.error(`模块文件缺失,跳过: ${filePath}`);
        continue;
      }
      const bytes = readFileSync(filePath);
      const actualSm3 = this.gm.sm3HashBytes(new Uint8Array(bytes));
      if (actualSm3 !== entry.sm3.toLowerCase()) {
        this.logger.error(
          `模块 SM3 与清单不符,跳过(拒绝分发): ${entry.file} ${actualSm3} ≠ ${entry.sm3}`,
        );
        continue;
      }
      if (!SUPPORTED_ABI_VERSIONS.includes(entry.abiVersion)) {
        this.logger.error(
          `模块 ABI ${entry.abiVersion} 不受支持,跳过: ${entry.file}`,
        );
        continue;
      }
      this.modules.set(actualSm3, { ...entry, sm3: actualSm3, bytes });
    }
    this.logger.log(
      `算法模块注册表已装载 ${this.modules.size} 个: ${[...this.modules.keys()]
        .map((s) => s.slice(0, 16))
        .join(", ")}`,
    );
  }

  list(): AlgorithmModuleManifest[] {
    return [...this.modules.values()].map(({ bytes: _bytes, ...rest }) => rest);
  }

  has(sm3: string): boolean {
    return this.modules.has(sm3.toLowerCase());
  }

  /** 模块清单(不含字节),供合约固定条款校验分析类型与 ABI。 */
  manifest(sm3: string): AlgorithmModuleManifest | undefined {
    const mod = this.modules.get(sm3.toLowerCase());
    if (!mod) return undefined;
    const { bytes: _bytes, ...rest } = mod;
    return rest;
  }

  /** 按 SM3 取模块(字节 base64 + 平台 CA 对 SM3 的 SM2 签名)。 */
  get(sm3: string): DistributedAlgorithmModule | undefined {
    const key = sm3.toLowerCase();
    const mod = this.modules.get(key);
    if (!mod) return undefined;
    let signature = this.signatures.get(key);
    if (!signature) {
      signature = this.ca.signModuleDigest(key);
      this.signatures.set(key, signature);
    }
    const { bytes, ...rest } = mod;
    return {
      ...rest,
      bytesBase64: bytes.toString("base64"),
      signature,
    };
  }
}
