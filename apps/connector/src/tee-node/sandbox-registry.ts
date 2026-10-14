/**
 * 节点侧阶段沙箱注册表（change `pack-med-sandboxes`）。
 *
 * 基座 MUST NOT import 行业沙箱实现（守护的依赖方向判据），所以行业包在**组装根**按 `opRef` 注册，
 * 执行器只按键解析。解析不到就回落内置分支（未迁移的算子行为不变）；
 * 内置也没有的算子由执行器自己的白名单在前一步拒掉（fail-closed）。
 */
import type { SandboxRegistry, StageSandbox } from '@medtrust/space-kernel-spi';

const sandboxes = new Map<string, StageSandbox>();

export function registerSandbox(sandbox: StageSandbox): void {
  sandboxes.set(sandbox.opRef, sandbox);
}

export function resolveSandbox(opRef: string): StageSandbox | undefined {
  return sandboxes.get(opRef);
}

export function registeredSandboxOpRefs(): string[] {
  return [...sandboxes.keys()];
}

/** SPI 约定的注册面（组装根把包声明交进来时用；基座侧实现）。 */
export const kernelSandboxRegistry: SandboxRegistry = {
  register: registerSandbox,
  resolve: (opRef: string) => resolveSandbox(opRef),
};
