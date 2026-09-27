import { Injectable, Logger } from '@nestjs/common';
import {
  MdopError,
  canonicalSm3,
  computeTraceMerkleRoot,
  generateTraceWitness,
  type ExecutionTraceStep,
  type ExecutionTraceWitness,
  type ServiceProtocolSpec,
} from '@medtrust/mdop';
import { connectorPublicKey } from '../../domain/connector-key';

export interface PipelineStageQuery {
  stageId: string;
  op: string;
  opDigest: string;
  params: Record<string, unknown>;
}

export interface ServicePipelineRunInput {
  jobId: string;
  contractId: string;
  applicant: string;
  serviceProtocol: ServiceProtocolSpec;
  queryStages: PipelineStageQuery[];
  corpusRecords: Array<Record<string, unknown>>;
  nodeUrn: string;
  privateKey?: string;
  now?: Date;
}

export interface ServicePipelineRunResult {
  c3Payload: {
    strata: Array<{ stratum: string; count: number; [key: string]: unknown }>;
    totalCount: number;
    suppressedCells: number;
    noiseAdded: boolean;
  };
  traceSteps: ExecutionTraceStep[];
  traceRoot: string;
  witness?: ExecutionTraceWitness;
}

@Injectable()
export class ServicePipelineExecutor {
  private readonly logger = new Logger(ServicePipelineExecutor.name);

  /**
   * 严格对照合约服务协议标准校验查询计划（fail-closed 拦截）。
   */
  validateQueryAgainstProtocol(input: ServicePipelineRunInput): void {
    const { serviceProtocol, queryStages } = input;
    const { topology, operator_whitelist, parameter_space } = serviceProtocol;

    // 1. 阶段拓扑对拍：阶段数与 stage_id 顺序必须严格匹配
    if (queryStages.length !== topology.stages.length) {
      throw new MdopError(
        'E_OP_NOT_WHITELISTED',
        {},
        `查询计划阶段数 (${queryStages.length}) 与合约协议拓扑 (${topology.stages.length}) 不符`,
      );
    }

    for (let i = 0; i < queryStages.length; i++) {
      const qStage = queryStages[i];
      const tStage = topology.stages[i];

      if (qStage.stageId !== tStage.stage_id) {
        throw new MdopError(
          'E_OP_NOT_WHITELISTED',
          {},
          `阶段标识不匹配：期望 ${tStage.stage_id}，收到 ${qStage.stageId}`,
        );
      }

      if (qStage.op !== tStage.required_op) {
        throw new MdopError(
          'E_OP_NOT_WHITELISTED',
          {},
          `阶段算子不匹配：期望 ${tStage.required_op}，收到 ${qStage.op}`,
        );
      }

      // 2. 算子白名单与 SM3 摘要强对拍
      const matchedWhitelist = operator_whitelist.find(
        (w) => `${w.op}@${w.version}` === qStage.op,
      );
      if (!matchedWhitelist) {
        throw new MdopError(
          'E_OP_NOT_WHITELISTED',
          {},
          `算子 ${qStage.op} 未列入合约白名单`,
        );
      }

      const normalizedDigest = qStage.opDigest.toLowerCase().replace(/^sm3:/, '');
      if (normalizedDigest !== matchedWhitelist.sm3_digest) {
        throw new MdopError(
          'E_OP_NOT_WHITELISTED',
          {},
          `算子完整性哈希不匹配：合约要求 ${matchedWhitelist.sm3_digest}，提交为 ${normalizedDigest}`,
        );
      }

      // 3. 参数空间防御校验
      this.validateParameterSpace(qStage.params, parameter_space);
    }
  }

  private validateParameterSpace(
    params: Record<string, unknown>,
    paramSpace: ServiceProtocolSpec['parameter_space'],
  ): void {
    // 检查过滤字段白名单
    if (params.filter_columns && Array.isArray(params.filter_columns)) {
      for (const col of params.filter_columns) {
        if (!paramSpace.allowed_filter_columns.includes(String(col))) {
          throw new MdopError(
            'E_LABEL_VIOLATION',
            {},
            `过滤字段 ${col} 超出合约参数空间白名单`,
          );
        }
      }
    }

    // 检查时间跨度
    if (params.time_window_days !== undefined) {
      const days = Number(params.time_window_days);
      if (
        paramSpace.max_time_window_days !== undefined &&
        days > paramSpace.max_time_window_days
      ) {
        throw new MdopError(
          'E_LABEL_VIOLATION',
          {},
          `查询时间窗口 ${days} 天超出合约上限 ${paramSpace.max_time_window_days} 天`,
        );
      }
    }

    // 检查分层分组字段白名单
    if (params.grouping_columns && Array.isArray(params.grouping_columns)) {
      for (const col of params.grouping_columns) {
        if (!paramSpace.allowed_grouping_columns.includes(String(col))) {
          throw new MdopError(
            'E_LABEL_VIOLATION',
            {},
            `分组字段 ${col} 超出合约参数空间白名单`,
          );
        }
      }
    }

    // 检查禁止谓词
    if (paramSpace.prohibited_predicates && params.predicates) {
      const predicatesStr = JSON.stringify(params.predicates);
      for (const prohibited of paramSpace.prohibited_predicates) {
        if (predicatesStr.includes(prohibited)) {
          throw new MdopError(
            'E_LABEL_VIOLATION',
            {},
            `查询包含合约明确禁止的谓词模式: ${prohibited}`,
          );
        }
      }
    }
  }

  /**
   * 飞地内分步流水线执行引擎：
   * $S_0 \xrightarrow{op_1} S_1 \xrightarrow{op_2} \dots \xrightarrow{op_k} S_k$。
   */
  async executePipeline(input: ServicePipelineRunInput): Promise<ServicePipelineRunResult> {
    this.validateQueryAgainstProtocol(input);

    const now = input.now ?? new Date();
    const traceSteps: ExecutionTraceStep[] = [];

    // 内存中间数据池（仅在飞地内存驻留，计算结束擦除）
    let currentData = [...input.corpusRecords];
    let currentInputDigest = canonicalSm3(currentData);

    let suppressedCells = 0;
    let finalStrata: Array<{ stratum: string; count: number; [key: string]: unknown }> = [];

    const finalStageIndex = input.queryStages.length - 1;

    for (let i = 0; i < input.queryStages.length; i++) {
      const stage = input.queryStages[i];
      const isFinal = i === finalStageIndex;
      const stepParamsDigest = canonicalSm3(stage.params);

      if (!isFinal) {
        // 中间算子：执行过滤、变换或投影，产物打上 C0_internal 标签
        const filterCol = stage.params.filter_column as string | undefined;
        const filterVal = stage.params.filter_value as unknown;

        if (filterCol && filterVal !== undefined) {
          currentData = currentData.filter((row) => row[filterCol] === filterVal);
        }

        const outputDigest = canonicalSm3(currentData);
        traceSteps.push({
          step_index: i,
          stage_id: stage.stageId,
          op: stage.op,
          op_digest: stage.opDigest,
          input_digest: currentInputDigest,
          output_digest: outputDigest,
          params_digest: stepParamsDigest,
          label: 'C0_internal',
        });
        currentInputDigest = outputDigest;
      } else {
        // 最终阶段：聚合与发布审查（小单元格抑制 + DP），产物标记为 C3
        const groupingCol = (stage.params.grouping_column as string) ?? 'category';
        const minCell = input.serviceProtocol.budget_policy.min_cell_size ?? 5;

        const counts = new Map<string, number>();
        for (const row of currentData) {
          const key = String(row[groupingCol] ?? 'unknown');
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }

        for (const [key, rawCount] of counts.entries()) {
          if (rawCount < minCell) {
            suppressedCells++;
            // 小单元格抑制：计数 < minCell 时置 0
            finalStrata.push({ stratum: key, count: 0, suppressed: true });
          } else {
            finalStrata.push({ stratum: key, count: rawCount });
          }
        }

        const totalCount = finalStrata.reduce((acc, s) => acc + s.count, 0);
        const c3Output = { strata: finalStrata, totalCount, suppressedCells };
        const outputDigest = canonicalSm3(c3Output);

        traceSteps.push({
          step_index: i,
          stage_id: stage.stageId,
          op: stage.op,
          op_digest: stage.opDigest,
          input_digest: currentInputDigest,
          output_digest: outputDigest,
          params_digest: stepParamsDigest,
          label: 'C3',
        });
        currentInputDigest = outputDigest;
      }
    }

    // 计算执行轨迹 Merkle 树根
    const traceRoot = computeTraceMerkleRoot(traceSteps);

    // 内存擦除（模拟飞地内部中间变量抹除）
    currentData = [];

    // 若配置了节点私钥，签发见证凭单
    let witness: ExecutionTraceWitness | undefined;
    if (input.privateKey) {
      const kid = canonicalSm3(connectorPublicKey(input.privateKey)).replace(/^sm3:/, '');
      witness = generateTraceWitness({
        jobId: input.jobId,
        contractId: input.contractId,
        node: input.nodeUrn,
        steps: traceSteps,
        resultDigest: currentInputDigest,
        privateKey: input.privateKey,
        publicKeyKid: kid,
        now,
      });
    }

    const totalCount = finalStrata.reduce((acc, s) => acc + s.count, 0);

    return {
      c3Payload: {
        strata: finalStrata,
        totalCount,
        suppressedCells,
        noiseAdded: false,
      },
      traceSteps,
      traceRoot,
      witness,
    };
  }
}
