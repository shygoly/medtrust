import {
  generateSm2KeyPair,
  verifyTraceWitness,
  type ServiceProtocolSpec,
} from '@medtrust/mdop';
import {
  ServicePipelineExecutor,
  type ServicePipelineRunInput,
} from './pipeline-executor';

describe('ServicePipelineExecutor（分步管道执行器与协议一致性校验）', () => {
  const nodeKey = generateSm2KeyPair();
  const nodeUrn = 'urn:medtrust:node:tee-test-01';

  let executor: ServicePipelineExecutor;

  beforeEach(() => {
    executor = new ServicePipelineExecutor();
  });

  const protocol: ServiceProtocolSpec = {
    protocol_version: 'medtrust.service_proto/1.0',
    target_corpus_ids: ['corpus_101'],
    topology: {
      stages: [
        {
          stage_id: 'step_filter',
          required_op: 'filter.row_filter@1.0.0',
          depends_on: ['ds://provider/corpus_101'],
          intermediate_label: 'C0_internal',
        },
        {
          stage_id: 'step_aggregate',
          required_op: 'stat.aggregation@1.0.0',
          depends_on: ['step_filter'],
          intermediate_label: 'C0_internal',
        },
      ],
      final_stage_id: 'step_aggregate',
    },
    operator_whitelist: [
      {
        op: 'filter.row_filter',
        version: '1.0.0',
        kind: 'wasm',
        sm3_digest: 'a'.repeat(64),
      },
      {
        op: 'stat.aggregation',
        version: '1.0.0',
        kind: 'wasm',
        sm3_digest: 'b'.repeat(64),
      },
    ],
    parameter_space: {
      allowed_filter_columns: ['category', 'active_flag'],
      max_time_window_days: 90,
      allowed_grouping_columns: ['category', 'subgroup'],
      prohibited_predicates: ['DROP', 'OR 1=1'],
    },
    budget_policy: {
      total_epsilon: 10.0,
      max_queries: 100,
      min_cell_size: 5,
    },
  };

  const corpusData = [
    { id: 1, category: 'cat_A', active_flag: true },
    { id: 2, category: 'cat_A', active_flag: true },
    { id: 3, category: 'cat_A', active_flag: true },
    { id: 4, category: 'cat_A', active_flag: true },
    { id: 5, category: 'cat_A', active_flag: true },
    { id: 6, category: 'cat_A', active_flag: true },
    // cat_B 仅 2 条，将被小单元格抑制
    { id: 7, category: 'cat_B', active_flag: true },
    { id: 8, category: 'cat_B', active_flag: true },
    // active_flag: false 将在步骤 1 被过滤掉
    { id: 9, category: 'cat_A', active_flag: false },
  ];

  const validRunInput: ServicePipelineRunInput = {
    jobId: 'job_svc_1001',
    contractId: 'contract_svc_01',
    applicant: 'pharma_analyst',
    serviceProtocol: protocol,
    queryStages: [
      {
        stageId: 'step_filter',
        op: 'filter.row_filter@1.0.0',
        opDigest: 'a'.repeat(64),
        params: {
          filter_columns: ['active_flag'],
          filter_column: 'active_flag',
          filter_value: true,
        },
      },
      {
        stageId: 'step_aggregate',
        op: 'stat.aggregation@1.0.0',
        opDigest: 'b'.repeat(64),
        params: {
          grouping_columns: ['category'],
          grouping_column: 'category',
        },
      },
    ],
    corpusRecords: corpusData,
    nodeUrn,
    privateKey: nodeKey.privateKey,
  };

  it('正常执行两阶段分步流水线，产出合规 C3 结果与不可抵赖执行见证', async () => {
    const result = await executor.executePipeline(validRunInput);

    expect(result.c3Payload).toBeDefined();
    expect(result.c3Payload.suppressedCells).toBe(1); // cat_B 被抑制

    const catA = result.c3Payload.strata.find((s) => s.stratum === 'cat_A');
    expect(catA?.count).toBe(6);

    const catB = result.c3Payload.strata.find((s) => s.stratum === 'cat_B');
    expect(catB?.count).toBe(0);
    expect(catB?.suppressed).toBe(true);

    // 检查步骤标签：中间步骤是 C0_internal，最终步骤是 C3
    expect(result.traceSteps).toHaveLength(2);
    expect(result.traceSteps[0].label).toBe('C0_internal');
    expect(result.traceSteps[1].label).toBe('C3');

    // 检查见证凭单
    expect(result.witness).toBeDefined();
    const verified = verifyTraceWitness(result.witness!, nodeKey.publicKey);
    expect(verified).toBe(true);
  });

  describe('违反合约协议标准时 fail-closed 拦截', () => {
    it('算子 SM3 摘要与合约白名单不一致被拒绝', async () => {
      const tampered = {
        ...validRunInput,
        queryStages: [
          {
            ...validRunInput.queryStages[0],
            opDigest: 'f'.repeat(64), // 恶意算子摘要
          },
          validRunInput.queryStages[1],
        ],
      };
      await expect(executor.executePipeline(tampered)).rejects.toThrow('算子完整性哈希不匹配');
    });

    it('阶段 ID 与拓扑顺序不符被拒绝', async () => {
      const tampered = {
        ...validRunInput,
        queryStages: [validRunInput.queryStages[1], validRunInput.queryStages[0]], // 乱序
      };
      await expect(executor.executePipeline(tampered)).rejects.toThrow('阶段标识不匹配');
    });

    it('过滤列超出合约参数空间白名单被拒绝', async () => {
      const tampered = {
        ...validRunInput,
        queryStages: [
          {
            ...validRunInput.queryStages[0],
            params: {
              filter_columns: ['unauthorized_secret_column'],
            },
          },
          validRunInput.queryStages[1],
        ],
      };
      await expect(executor.executePipeline(tampered)).rejects.toThrow('超出合约参数空间白名单');
    });

    it('时间跨度超出合约限制被拒绝', async () => {
      const tampered = {
        ...validRunInput,
        queryStages: [
          {
            ...validRunInput.queryStages[0],
            params: {
              time_window_days: 180, // 上限是 90 天
            },
          },
          validRunInput.queryStages[1],
        ],
      };
      await expect(executor.executePipeline(tampered)).rejects.toThrow('超出合约上限 90 天');
    });

    it('包含禁止谓词被拒绝', async () => {
      const tampered = {
        ...validRunInput,
        queryStages: [
          {
            ...validRunInput.queryStages[0],
            params: {
              predicates: ['SELECT * FROM data WHERE 1=1 OR 1=1'],
            },
          },
          validRunInput.queryStages[1],
        ],
      };
      await expect(executor.executePipeline(tampered)).rejects.toThrow('包含合约明确禁止的谓词模式');
    });
  });
});
