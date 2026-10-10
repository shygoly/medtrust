// SPDX-License-Identifier: LicenseRef-MedTrust-Research-1.0
// SPDX-FileCopyrightText: MedTrust contributors
import { AsyncLocalStorage } from "node:async_hooks";

/** 请求级空间上下文（D-SPD-2）。 */
export interface SpaceContextValue {
  readonly spaceId: string;
  readonly traceId?: string;
}

const storage = new AsyncLocalStorage<SpaceContextValue>();

/** 在给定空间上下文内执行；取代 process.env.SPACE_ID 的进程级单例（D-SPD-2）。 */
export function runInSpaceContext<T>(value: SpaceContextValue, fn: () => T): T {
  return storage.run(value, fn);
}

export function currentSpace(): SpaceContextValue | undefined {
  return storage.getStore();
}

/** fail-closed：无空间上下文即拒绝，MUST NOT 回落到任何默认空间。 */
export function requireSpace(): SpaceContextValue {
  const value = storage.getStore();
  if (!value) throw new Error("SPACE_CONTEXT_MISSING");
  return value;
}
