import { AggregateResult } from '../types';

export interface RunLocalCausalParams {
  taskId: string;
  method: string;
  specJson: string;
  cohortJson: string;
}

export interface RunLocalCausalResponse {
  ackStatus: string;
  resultJson: string;
  message?: string;
}

export type CausalInvokeFn = (
  params: RunLocalCausalParams,
) => Promise<RunLocalCausalResponse>;

/** 解析 agent 安全结果 JSON → AggregateResult. */
export function parseCausalAgentResult(json: string): AggregateResult {
  const parsed = JSON.parse(json) as AggregateResult;
  if (!parsed?.analysisType || !Array.isArray(parsed.buckets)) {
    throw new Error('agent 返回非法聚合结果');
  }
  const blob = JSON.stringify(parsed);
  if (blob.includes('subjectKey') || blob.includes('patientId')) {
    throw new Error('agent 结果含行级数据');
  }
  return parsed;
}
