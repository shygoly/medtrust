import { SPACE_ID } from "@medtrust/demo-scenario";

/**
 * 有请求空间时，行必须属于该空间。
 * 还没写 spaceId 的旧行只归默认空间，不能在第二个空间里被读到。
 * 没有请求空间时不过滤，避免启动种子和单测被空上下文藏掉。
 */
export function rowVisibleInSpace(
  row: { spaceId?: string | null },
  current: string | undefined,
): boolean {
  if (!current) return true;
  return (row.spaceId || SPACE_ID) === current;
}

export function spaceIdForWrite(current: string | undefined): string {
  return current || SPACE_ID;
}
