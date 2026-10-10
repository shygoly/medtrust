import { Injectable } from "@nestjs/common";
import {
  currentSpace,
  requireSpace,
  runInSpaceContext,
  type SpaceContextValue,
} from "@medtrust/space-kernel";

/**
 * 请求级空间上下文载体（P2.2）。
 *
 * 单一实现来自基座 `@medtrust/space-kernel`；本服务只是 Nest 侧门面，
 * 避免出现第二套机制。取代 `process.env.SPACE_ID` 的进程级单例（D-SPD-2）。
 */
@Injectable()
export class SpaceContextService {
  run<T>(value: SpaceContextValue, fn: () => T): T {
    return runInSpaceContext(value, fn);
  }

  current(): SpaceContextValue | undefined {
    return currentSpace();
  }

  /** fail-closed：无空间上下文即抛错，MUST NOT 回落默认空间。 */
  require(): SpaceContextValue {
    return requireSpace();
  }
}
