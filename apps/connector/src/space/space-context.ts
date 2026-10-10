import { currentSpace, runInSpaceContext } from '@medtrust/space-kernel';

export const DEFAULT_CONNECTOR_SPACE = 'sh-med';

let warned = false;

/**
 * 连接器的当前空间（P10.1 / D-SPD-2）。
 *
 * 连接器**不做"切换"**：它同时服务本院加入的**全部**空间（多栈），
 * 因此空间必须来自任务 / 请求上下文，而不是进程级 env。
 * 过渡期保留 SPACE_ID 兜底并输出一次弃用告警（单栈部署行为零变更）。
 */
export function currentConnectorSpaceId(): string {
  const ctx = currentSpace();
  if (ctx?.spaceId) return ctx.spaceId;
  const env = (process.env.SPACE_ID ?? '').trim();
  if (env) {
    if (!warned) {
      warned = true;
      console.warn(
        '[ConnectorSpace] SPACE_ID 已弃用：连接器按任务上下文解析空间（D-SPD-2）。',
      );
    }
    return env;
  }
  return DEFAULT_CONNECTOR_SPACE;
}

/** 在某一空间上下文中执行（任务派发 / 长轮询按空间分栈的入口）。 */
export function runInConnectorSpace<T>(spaceId: string, fn: () => T): T {
  return runInSpaceContext({ spaceId }, fn);
}

/** 仅供测试：重置弃用告警的一次性标记。 */
export function resetConnectorSpaceWarningForTest(): void {
  warned = false;
}
