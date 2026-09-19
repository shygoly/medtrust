// algorithm-sandbox — 资源上限与超限失败(design D1/D10)。
//
// 每次执行启动一个 worker(env: {} / execArgv: [] / resourceLimits);宿主等超时即
// terminate()。任何超限或失败都抛出,由任务层判失败 —— 不回退到内置实现。
import { Injectable, Optional } from '@nestjs/common';
import { Worker } from 'worker_threads';
import { AuditService } from '../audit';
import { SANDBOX_WORKER_SOURCE } from './sandbox-worker';

export const DEFAULT_SANDBOX_TIMEOUT_MS = 10_000;
export const DEFAULT_SANDBOX_MAX_MEMORY_MB = 64;

export interface SandboxRunRequest {
  analysisType: string;
  moduleSm3: string;
  /** 模块字节(已通过双重校验)。 */
  moduleBytes: Uint8Array;
  /** 最小列投影后的输入载荷,宿主写入偏移 0。 */
  input: Uint8Array;
  /** run() 的入参。 */
  n: number;
  k: number;
  /** 输出区偏移与字节数。 */
  outOff: number;
  outBytes: number;
  taskId?: string;
}

export interface SandboxRunResult {
  output: Uint8Array;
  abiVersion: number;
  memoryPages: number;
  durationMs: number;
  /** worker 内可见的环境变量个数(应为 0 —— worker 不继承宿主环境)。 */
  envVarCount: number;
}

export class SandboxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxLimitError';
  }
}

export class SandboxRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxRunError';
  }
}

export function sandboxTimeoutMs(): number {
  const raw = Number(process.env.CONNECTOR_SANDBOX_TIMEOUT_MS ?? DEFAULT_SANDBOX_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SANDBOX_TIMEOUT_MS;
}

export function sandboxMaxMemoryBytes(): number {
  const raw = Number(
    process.env.CONNECTOR_SANDBOX_MAX_MEMORY_MB ?? DEFAULT_SANDBOX_MAX_MEMORY_MB,
  );
  const mb = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SANDBOX_MAX_MEMORY_MB;
  return Math.floor(mb * 1024 * 1024);
}

@Injectable()
export class WasmSandboxRunner {
  constructor(@Optional() private readonly audit?: AuditService) {}

  /**
   * 调用前检查所需字节数:超过沙箱上限即在调用模块之前拒绝(不给模块分配的机会)。
   */
  assertWithinMemoryLimit(requiredBytes: number): void {
    const limit = sandboxMaxMemoryBytes();
    if (requiredBytes > limit) {
      throw new SandboxLimitError(
        `输入所需内存 ${requiredBytes} 字节 > 沙箱上限 ${limit} 字节` +
          `(CONNECTOR_SANDBOX_MAX_MEMORY_MB),拒绝调用算法模块`,
      );
    }
  }

  async run(req: SandboxRunRequest): Promise<SandboxRunResult> {
    const requiredBytes = req.outOff + req.outBytes;
    this.assertWithinMemoryLimit(requiredBytes);

    const timeoutMs = sandboxTimeoutMs();
    const configMaxPages = Math.max(1, Math.floor(sandboxMaxMemoryBytes() / 65536));
    const startedAt = Date.now();

    const worker = new Worker(SANDBOX_WORKER_SOURCE, {
      eval: true,
      env: {}, // 不继承宿主环境变量(模块与胶水代码都拿不到密钥)
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 32,
        maxYoungGenerationSizeMb: 4,
        stackSizeMb: 4,
      },
    });

    const moduleBytes = req.moduleBytes.slice().buffer;
    const input = req.input.slice().buffer;
    // 超时 terminate 会让 worker 以非零码退出;此时 exit 事件不代表异常终止。
    let terminating = false;
    const reply = this.awaitMessage(worker, () => terminating);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(async () => {
        // V8 在 Wasm 循环里插了中断检查,terminate() 对死循环同样有效。
        terminating = true;
        await worker.terminate();
        reject(new SandboxLimitError(`沙箱执行超时(${timeoutMs}ms),已终止 worker`));
      }, timeoutMs);
    });

    try {
      worker.postMessage(
        {
          moduleBytes,
          input,
          n: req.n,
          k: req.k,
          outOff: req.outOff,
          outBytes: req.outBytes,
          configMaxPages,
        },
        [moduleBytes, input],
      );
      const result = await Promise.race([reply, timeout]);
      if (!result.ok) {
        throw new SandboxRunError(
          `沙箱执行失败[${result.reason}]:${result.error}`,
        );
      }
      const output = new Uint8Array(result.output);
      const durationMs = result.durationMs ?? Date.now() - startedAt;
      this.audit?.record({
        action: 'sandbox-run',
        actor: req.taskId ?? 'wasm-sandbox',
        allowed: true,
        detail:
          `analysis=${req.analysisType} sm3=${req.moduleSm3} abi=${result.abiVersion}` +
          ` n=${req.n} k=${req.k} memoryPages=${result.memoryPages} durationMs=${durationMs}` +
          ` envVars=${result.envVarCount ?? 0}`,
      });
      return {
        output,
        abiVersion: result.abiVersion,
        memoryPages: result.memoryPages,
        durationMs,
        envVarCount: result.envVarCount ?? 0,
      };
    } catch (err) {
      this.audit?.record({
        action: 'sandbox-fail',
        actor: req.taskId ?? 'wasm-sandbox',
        allowed: false,
        detail: `analysis=${req.analysisType} sm3=${req.moduleSm3} reason=${(err as Error).message}`,
      });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      await worker.terminate();
    }
  }

  private awaitMessage(worker: Worker, isTerminating: () => boolean): Promise<{
    ok: boolean;
    reason?: string;
    error?: string;
    output: ArrayBuffer;
    abiVersion: number;
    memoryPages: number;
    durationMs?: number;
    envVarCount?: number;
  }> {
    return new Promise((resolve, reject) => {
      worker.once('message', (msg) => resolve(msg));
      worker.once('error', (err) => reject(err));
      worker.once('exit', (code) => {
        // 正常路径由 message 先 resolve;exit 只在异常终止时兜底(故无需清理监听)。
        if (code !== 0 && !isTerminating()) {
          reject(new Error(`沙箱 worker 异常退出,退出码 ${code}`));
        }
      });
    });
  }
}
