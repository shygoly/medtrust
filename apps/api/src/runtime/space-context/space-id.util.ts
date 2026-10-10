import { currentSpace } from "@medtrust/space-kernel";
import { SPACE_ID } from "@medtrust/demo-scenario";

let warned = false;

/**
 * 解析当前空间 id（P2.4 / D-SPD-2）。
 *
 * 优先级：请求级空间上下文 → 环境变量 SPACE_ID（过渡期，弃用）→ 默认空间。
 * 业务代码 MUST 用本函数，MUST NOT 直接读 process.env.SPACE_ID；环境变量兜底在
 * 单空间部署下与改造前行为完全一致，仅首次读取时输出一次弃用告警。
 */
export function currentSpaceId(): string {
  const ctx = currentSpace();
  if (ctx?.spaceId) return ctx.spaceId;
  const env = process.env.SPACE_ID?.trim();
  if (env) {
    if (!warned) {
      warned = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[SpaceId] process.env.SPACE_ID 已弃用：请改用请求级空间上下文（D-SPD-2）。",
      );
    }
    return env;
  }
  return SPACE_ID;
}

/** 仅供测试：重置弃用告警的一次性标记。 */
export function resetSpaceIdWarningForTest(): void {
  warned = false;
}
