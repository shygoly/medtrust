// algorithm-sandbox — 执行隔离展示口径(如实标注,不夸大)。
//
// 与 attestationLevel(信任级别,当前恒 software)正交:
//   - wasm-sandbox = 算法模块在零能力 Wasm 沙箱内运行(代码能力受限);
//   - none         = 连接器内置实现(软件、同进程、无隔离)。
// 任何"沙箱 = TEE / 已具备硬件机密计算"的表述都是虚标(CTL-09)。

export type ExecutionIsolation = 'none' | 'wasm-sandbox';

export function isExecutionIsolation(value: unknown): value is ExecutionIsolation {
  return value === 'none' || value === 'wasm-sandbox';
}

/** 按医院显示的执行隔离文案。 */
export function executionIsolationLabel(
  isolation: string | undefined,
  moduleSm3?: string,
): string {
  if (isolation === 'wasm-sandbox') {
    const fingerprint = moduleSm3 ? `${moduleSm3.slice(0, 16)}…` : '未知';
    return `执行隔离:Wasm 沙箱 · 模块 ${fingerprint}`;
  }
  return '执行隔离:无隔离(软件、同进程)';
}

/** 信任级别恒为 software —— 沙箱落地不改变 attestationLevel。 */
export function trustLevelLabel(attestationLevel?: string): string {
  return attestationLevel === 'hardware'
    ? '信任级别:硬件远程证明'
    : '信任级别:software(无远程证明)';
}
