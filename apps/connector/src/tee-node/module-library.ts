import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 节点**本地模块库**（任务 3.12g 的落地形态）：按摘要取算子模块字节。
 *
 * 为什么是「本地目录 + 摘要命名」而不是「从平台现取」：
 *  ① 执行时机不该依赖网络与另一个信任面（平台只发清单与吊销，不发字节）；
 *  ② **文件名的摘要就是准入决定**——运维把一个模块放进来，等于说「这台机器允许跑这段代码」；
 *     平台消息做不到这件事（它能做的只有「提供清单」与「吊销」）。
 *
 * 目录约定：`<dir>/<sm3hex>.wasm`（摘要为 **SM3**，与清单里的 `digest` 同源）。
 * 读取时只认**32 字节十六进制**文件名，且**不接受**任何带路径分隔符的摘要（防目录穿越）。
 */

/**
 * 造一个「按摘要取字节」的取数器。
 *
 * 取不到（文件不存在 / 摘要非法 / 目录不存在）一律返回 `undefined`——**调用方 fail-closed**，
 * 这里不抛错也不兜底：把「没有这个模块」伪装成别的东西，会让复核与执行两处的判据分叉。
 */
export function moduleLibrary(dir: string): (digest: string) => Uint8Array | undefined {
  const cache = new Map<string, Uint8Array>();
  return (digest: string): Uint8Array | undefined => {
    const hex = String(digest ?? '')
      .replace(/^sm3:/i, '')
      .toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return undefined;
    const cached = cache.get(hex);
    if (cached) return cached;
    try {
      const bytes = new Uint8Array(readFileSync(join(dir, `${hex}.wasm`)));
      cache.set(hex, bytes);
      return bytes;
    } catch {
      return undefined;
    }
  };
}

/** 目录里现有的模块摘要（运维自检/日志用；目录不存在返回空表）。 */
export function listModuleDigests(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => /^[0-9a-f]{64}\.wasm$/.test(name))
      .map((name) => name.replace(/\.wasm$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/** 节点运行时的模块库配置（逐键 `process.env.<KEY>` 直读：与部署登记表双向对拍）。 */
export function nodeModuleEnv(): { moduleDir: string } {
  return { moduleDir: (process.env.TEE_NODE_MODULE_DIR ?? '').trim() };
}
