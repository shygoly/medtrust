import { api } from "@/api/client";

export type MdopCompileResult = {
  jobId: string;
  status: string;
  planHash: string;
  fragments: Array<{ node: string; stages: number; edges: number }>;
  ticketId?: string;
  offeredNodes?: string[];
};

/**
 * 提交成功后立刻编译并发起要约（控制台补 FLOW-MDOP-01 第二步）。
 * 作业已存在；编译失败时抛错，调用方应保留详情链接供重试。
 */
export async function afterMdopSubmit(
  jobId: string,
): Promise<MdopCompileResult> {
  return api.compileMdopJob(jobId);
}

/** 提交+编译结果的跟进文案。 */
export function mdopFollowUpMessage(
  jobId: string,
  compiled: MdopCompileResult | null,
  compileError?: string,
): string {
  if (compileError) {
    return `已提交作业 ${jobId}，但编译失败：${compileError}（可在作业详情重试）`;
  }
  const status = compiled?.status ?? "SUBMITTED";
  return `已提交并编译作业 ${jobId}（状态 ${status}，可在作业详情跟进）`;
}
