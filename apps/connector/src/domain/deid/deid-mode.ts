// 脱敏通道开关（`CONNECTOR_DEID_MODE`，design §9 / proposal「开关与兼容」）。
//
//   builtin（缺省）—— 连接器内 `Deidentifier` 逐行脱敏：演示/小数据/无 agent 部署。
//   agent          —— 脱敏下沉到院内 Python agent：任何"连接器自己脱敏"的路径都**禁止**。
//
// `agent` 模式下不给"尽力而为"的后路：agent 不可达、规格不可用、回执不符 → 任务失败。
// 用内置弱脱敏兜底会让同一份数据在不同院得到不同口径，正是本变更要消灭的东西。

export type DeidMode = 'builtin' | 'agent';

export const DEID_MODES: readonly DeidMode[] = ['builtin', 'agent'];

export class DeidBypassForbidden extends Error {
  constructor(message: string) {
    super(`DEID_BYPASS_FORBIDDEN: ${message}`);
    this.name = 'DeidBypassForbidden';
  }
}

/** 解析 `CONNECTOR_DEID_MODE`；非法值不静默回落，直接判为配置错误。 */
export function resolveDeidMode(raw: string | undefined = process.env.CONNECTOR_DEID_MODE): DeidMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return 'builtin';
  if (value === 'builtin' || value === 'agent') return value;
  throw new Error(
    `CONNECTOR_DEID_MODE 非法：${raw}（只接受 builtin|agent；拒绝猜测，缺省 builtin）`,
  );
}

/**
 * agent 模式下的绕过检查：连接器不得再走本地逐行脱敏。
 * 所有"入本地存储前脱敏"的分支都必须先过这一道。
 */
export function assertNoBuiltinBypass(mode: DeidMode, where: string): void {
  if (mode === 'agent')
    throw new DeidBypassForbidden(
      `${where} 试图在 agent 模式下本地脱敏；脱敏口径由平台签发的规格决定，` +
        `只能经院内 agent 执行（规格缺失/不可用即任务失败，不退回内置弱脱敏）`,
    );
}
