import {
  canonicalSm3,
  generateSm2KeyPair,
  mapVendorQuote,
  reportDataBinding,
  verifyTraceWitness,
  type AttestationPolicy,
  type AttestationProvider,
  type AttestationReport,
  type KeyReleaseRequest,
  type KeyReleaseWarrant,
  type KmsClient,
  type ServiceProtocolSpec,
  type VendorQuote,
} from '@medtrust/mdop';
import { NodeQueryBudgetLedger } from './budget-ledger';
import { CorpusStore, type CorpusArtifactRecord } from './corpus-store';
import {
  ServicePipelineExecutor,
  type PipelineStageQuery,
  type ServicePipelineRunInput,
} from './pipeline-executor';

/**
 * 服务计算（Service Computing）端到端集成测试套件
 * 
 * 涵盖：
 *  1. 场景设计：药企 × 医院罕见病长期监测服务计算
 *  2. 合约设计：声明式 service_protocol 强约束（拓扑、算子白名单、参数空间、累积预算）
 *  3. 服务设计：C2 密封语料托管、持久化存盘与语料句柄登记
 *  4. 运行监督：逐次会话硬件证明校验、KMS 临时密钥释放、飞地多步管道执行、参数越界与注入拦截、累积预算扣减与频次熔断
 *  5. 最终报告：C3 结果小单元格抑制、算子执行轨迹 Merkle 树见证与验签、合约清退物理销毁回执
 */

const NOW = new Date('2026-09-27T10:00:00.000Z');
const SPACE = 'sh-med';
const TEE_NODE = `urn:tds:${SPACE}:participant:tee-node-01`;
const PROVIDER_HOSP = `urn:tds:${SPACE}:participant:p-huashan`;
const CONSUMER_PHARMA = `urn:tds:${SPACE}:participant:c-pharma`;
const CONTRACT_ID = 'contract-rare-disease-2026';
const CORPUS_ID = 'corpus-cohort-2026';
const CORPUS_HANDLE = `corpus://${CONTRACT_ID}/${CORPUS_ID}`;

const OP_FILTER = 'filter.row_filter@1.0.0';
const OP_FILTER_SM3 = 'a'.repeat(64);
const OP_AGG = 'stat.aggregation@1.0.0';
const OP_AGG_SM3 = 'b'.repeat(64);

const POLICY: AttestationPolicy = { tee: ['tdx'], min_tcb: { tdx: '3.1.0' } };

/** 软件模拟 TEE 提供者（产出符合 TDX 证明规范的测试 Quote 与一次性公钥） */
class MockTeeAttestationProvider implements AttestationProvider {
  readonly providerKind = 'tdx' as const;
  private currentKeyPair = generateSm2KeyPair();

  get ephemeralPublicKey(): string {
    return this.currentKeyPair.publicKey;
  }

  get ephemeralPrivateKey(): string {
    return this.currentKeyPair.privateKey;
  }

  rotateSessionKey(): void {
    this.currentKeyPair = generateSm2KeyPair();
  }

  async prove(): Promise<AttestationReport> {
    const now = new Date();
    const quote: VendorQuote = {
      vendor: 'tdx',
      measurement: `sm3:${'e'.repeat(64)}`,
      tcb: '3.1.2',
      quote: 'bW9jay10ZHgtcXVvdGU=',
      signed_at: new Date(now.getTime() - 10_000).toISOString(),
      valid_until: new Date(now.getTime() + 300_000).toISOString(),
      ephemeral_public_key: this.currentKeyPair.publicKey,
      report_data: reportDataBinding(this.currentKeyPair.publicKey),
      node: TEE_NODE,
    };
    return mapVendorQuote(quote);
  }
}

/** 模拟数据持有方独立 KMS */
class MockHospitalKms implements KmsClient {
  readonly kmsRef = 'kms://huashan-hospital-kms';
  private readonly keys = new Map<string, string>();
  releaseCount = 0;

  constructor(private readonly kmsKeyPair = generateSm2KeyPair()) {}

  registerKey(keyId: string, secretDek: string): void {
    this.keys.set(keyId, secretDek);
  }

  async requestRelease(input: KeyReleaseRequest): Promise<KeyReleaseWarrant> {
    this.releaseCount++;
    const dek = this.keys.get(input.key_id);
    if (!dek) throw new Error(`KMS 未找到数据密钥: ${input.key_id}`);

    // 严格检查证明报告中的度量与一次性公钥
    if (!input.report.ephemeral_public_key) {
      throw new Error('证明中缺少一次性公钥，拒绝释放密钥');
    }

    const now = new Date();
    return {
      key_id: input.key_id,
      kms: this.kmsRef,
      warrant_digest: canonicalSm3({ key_id: input.key_id, req: this.releaseCount }),
      wrapped_key: `enc_with_${input.report.ephemeral_public_key.slice(0, 16)}:${dek}`,
      wrapped_key_encoding: 'hex',
      ephemeral_key_digest: canonicalSm3(input.report.ephemeral_public_key),
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 600_000).toISOString(),
      sig: {
        alg: 'SM2-SM3',
        kid: 'kms-key-id-01',
        value: 'sig_mock_kms_warrant',
      },
    };
  }
}

describe('服务计算端到端全链路测试套件（Service Computing E2E）', () => {
  const nodeKeyPair = generateSm2KeyPair();
  let corpusStore: CorpusStore;
  let budgetLedger: NodeQueryBudgetLedger;
  let pipelineExecutor: ServicePipelineExecutor;
  let teeProvider: MockTeeAttestationProvider;
  let hospitalKms: MockHospitalKms;

  // 1. 场景设计与测试合成数据构造
  // 400 例罕见病队列样本：
  //   - 395 例年龄在 20-79 岁
  //   - 5 例高龄（>=80岁），其中伴发特定不良事件者仅 2 例（用于测试小单元格抑制）
  const syntheticCohortData: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 395; i++) {
    syntheticCohortData.push({
      patient_id: `p_${i}`,
      age_group: i % 2 === 0 ? '40-59' : '60-79',
      active_therapy: true,
      adverse_event: i % 10 === 0, // 10% 发生不良反应
      days_on_therapy: 30 + (i % 60),
    });
  }
  // 注入 5 例极端高龄样本
  syntheticCohortData.push(
    { patient_id: 'p_elder_1', age_group: '80+', active_therapy: true, adverse_event: true, days_on_therapy: 45 },
    { patient_id: 'p_elder_2', age_group: '80+', active_therapy: true, adverse_event: true, days_on_therapy: 50 },
    { patient_id: 'p_elder_3', age_group: '80+', active_therapy: true, adverse_event: false, days_on_therapy: 12 },
    { patient_id: 'p_elder_4', age_group: '80+', active_therapy: false, adverse_event: false, days_on_therapy: 5 },
    { patient_id: 'p_elder_5', age_group: '80+', active_therapy: true, adverse_event: false, days_on_therapy: 20 },
  );

  // 2. 合约设计：声明式服务计算协议标准（ServiceProtocolSpec）
  const serviceProtocol: ServiceProtocolSpec = {
    protocol_version: 'medtrust.service_proto/1.0',
    target_corpus_ids: [CORPUS_ID],
    topology: {
      stages: [
        {
          stage_id: 'step_filter',
          required_op: OP_FILTER,
          depends_on: [`ds://${PROVIDER_HOSP}/${CORPUS_ID}`],
          intermediate_label: 'C0_internal', // 飞地内部流转，严禁出域
        },
        {
          stage_id: 'step_aggregate',
          required_op: OP_AGG,
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
        sm3_digest: OP_FILTER_SM3,
      },
      {
        op: 'stat.aggregation',
        version: '1.0.0',
        kind: 'wasm',
        sm3_digest: OP_AGG_SM3,
      },
    ],
    parameter_space: {
      allowed_filter_columns: ['active_therapy', 'adverse_event'],
      max_time_window_days: 90,
      allowed_grouping_columns: ['age_group'],
      prohibited_predicates: ['DROP', 'OR 1=1', 'DELETE'],
    },
    budget_policy: {
      total_epsilon: 5.0,
      delta: 1e-5,
      max_queries: 5,
      min_cell_size: 5,
      rate_limit_per_hour: 3,
      circuit_breaker_enabled: true,
    },
  };

  beforeEach(() => {
    corpusStore = new CorpusStore({
      node: TEE_NODE,
      privateKey: nodeKeyPair.privateKey,
    });
    budgetLedger = new NodeQueryBudgetLedger();
    pipelineExecutor = new ServicePipelineExecutor();
    teeProvider = new MockTeeAttestationProvider();
    hospitalKms = new MockHospitalKms();
    hospitalKms.registerKey('dek-corpus-2026', 'secret_symmetric_dek_value');
  });

  describe('阶段 1：服务设计与语料密态存盘托管', () => {
    it('提供方将队列以 C2 密态信封持久化托管至 TEE 节点，生成语料句柄', () => {
      const corpusRecord: CorpusArtifactRecord = {
        corpusHandle: CORPUS_HANDLE,
        contractId: CONTRACT_ID,
        corpusId: CORPUS_ID,
        label: 'C2',
        digest: canonicalSm3(syntheticCohortData),
        envelope: {
          apiVersion: 'mdop.env/1.0',
          ciphertext: 'mock_encrypted_cohort_blob',
          wrapped_key: {
            kms: hospitalKms.kmsRef,
            key_id: 'dek-corpus-2026',
          },
        },
        provider: PROVIDER_HOSP,
        registeredAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 365 * 86400 * 1000).toISOString(),
      };

      corpusStore.put(corpusRecord);

      const retrieved = corpusStore.get(CORPUS_HANDLE);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.contractId).toBe(CONTRACT_ID);
      expect(retrieved?.provider).toBe(PROVIDER_HOSP);
      expect(retrieved?.label).toBe('C2');
    });
  });

  describe('阶段 2：运行监督与逐次服务查询执行', () => {
    beforeEach(() => {
      // 预先存入语料
      corpusStore.put({
        corpusHandle: CORPUS_HANDLE,
        contractId: CONTRACT_ID,
        corpusId: CORPUS_ID,
        label: 'C2',
        digest: canonicalSm3(syntheticCohortData),
        envelope: {
          apiVersion: 'mdop.env/1.0',
          ciphertext: 'mock_encrypted_cohort_blob',
          wrapped_key: {
            kms: hospitalKms.kmsRef,
            key_id: 'dek-corpus-2026',
          },
        },
        provider: PROVIDER_HOSP,
        registeredAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 365 * 86400 * 1000).toISOString(),
      });
    });

    const standardQueryStages: PipelineStageQuery[] = [
      {
        stageId: 'step_filter',
        op: OP_FILTER,
        opDigest: OP_FILTER_SM3,
        params: {
          filter_columns: ['active_therapy'],
          filter_column: 'active_therapy',
          filter_value: true,
          time_window_days: 60,
        },
      },
      {
        stageId: 'step_aggregate',
        op: OP_AGG,
        opDigest: OP_AGG_SM3,
        params: {
          grouping_columns: ['age_group'],
          grouping_column: 'age_group',
        },
      },
    ];

    it('正常单次查询：证明校验 -> KMS 会话临时密钥释放 -> 飞地流水线执行 -> 预算扣减 -> C3 产出', async () => {
      // 1. TEE 软件模拟证明生成
      const attestationReport = await teeProvider.prove();
      expect(attestationReport.kind).toBe('tdx');
      expect(attestationReport.level).toBe('hardware');
      expect(attestationReport.ephemeral_public_key).toBeTruthy();

      // 2. KMS 释放会话密钥（仅封给本次会话一次性公钥）
      const keyWarrant = await hospitalKms.requestRelease({
        key_id: 'dek-corpus-2026',
        key_owner: { job_id: 'job_svc_1', contract_id: CONTRACT_ID },
        context: { job_id: 'job_svc_1', credential_id: 'cred_1', contract_id: CONTRACT_ID },
        report: attestationReport,
        policy: POLICY,
        credential_valid: true,
        contract_active: true,
      });
      expect(keyWarrant.wrapped_key).toContain(teeProvider.ephemeralPublicKey.slice(0, 16));

      // 3. 运行监督：查询前预算断言与扣减
      budgetLedger.assertServiceBudgetWithin({
        contractId: CONTRACT_ID,
        applicant: CONSUMER_PHARMA,
        costEpsilon: 0.5,
        policy: serviceProtocol.budget_policy,
      });

      // 4. 飞地内部执行分步流水线
      const runInput: ServicePipelineRunInput = {
        jobId: 'job_svc_1',
        contractId: CONTRACT_ID,
        applicant: CONSUMER_PHARMA,
        serviceProtocol,
        queryStages: standardQueryStages,
        corpusRecords: syntheticCohortData,
        nodeUrn: TEE_NODE,
        privateKey: nodeKeyPair.privateKey,
        now: NOW,
      };

      const result = await pipelineExecutor.executePipeline(runInput);

      // 5. 扣减账本
      const usage = budgetLedger.chargeServiceBudget({
        contractId: CONTRACT_ID,
        applicant: CONSUMER_PHARMA,
        costEpsilon: 0.5,
        policy: serviceProtocol.budget_policy,
      });
      expect(usage.usedEpsilon).toBe(0.5);
      expect(usage.totalQueries).toBe(1);

      // 6. 最终报告校验：
      // - 40-59 与 60-79 正常发布
      // - 80+ 亚组共 4 例在疗程中，由于 4 < 5，触发小单元格抑制置 0 并标记 suppressed
      expect(result.c3Payload).toBeDefined();
      expect(result.c3Payload.suppressedCells).toBe(1);

      const elderGroup = result.c3Payload.strata.find((s) => s.stratum === '80+');
      expect(elderGroup?.count).toBe(0);
      expect(elderGroup?.suppressed).toBe(true);

      // 7. 执行轨迹与见证校验（交付即验证）
      expect(result.witness).toBeDefined();
      expect(result.witness?.trace_root).toBeTruthy();
      expect(result.witness?.step_count).toBe(2);

      const isWitnessValid = verifyTraceWitness(result.witness!, nodeKeyPair.publicKey);
      expect(isWitnessValid).toBe(true);
    });

    describe('安全防御边界：拦截参数越界与算子篡改（fail-closed）', () => {
      it('参数包含未白名单的字段（尝试嗅探未授权列）时当场阻断', async () => {
        const tamperedQuery: PipelineStageQuery[] = [
          {
            stageId: 'step_filter',
            op: OP_FILTER,
            opDigest: OP_FILTER_SM3,
            params: {
              filter_columns: ['secret_genetic_marker'], // 未在参数空间白名单内
            },
          },
          standardQueryStages[1],
        ];

        const runInput: ServicePipelineRunInput = {
          jobId: 'job_tamper_1',
          contractId: CONTRACT_ID,
          applicant: CONSUMER_PHARMA,
          serviceProtocol,
          queryStages: tamperedQuery,
          corpusRecords: syntheticCohortData,
          nodeUrn: TEE_NODE,
        };

        await expect(pipelineExecutor.executePipeline(runInput)).rejects.toThrow(
          '超出合约参数空间白名单',
        );
      });

      it('时间跨度超出合约限制（如申请 180 天 > 合约允许 90 天）时当场阻断', async () => {
        const tamperedQuery: PipelineStageQuery[] = [
          {
            stageId: 'step_filter',
            op: OP_FILTER,
            opDigest: OP_FILTER_SM3,
            params: {
              time_window_days: 180,
            },
          },
          standardQueryStages[1],
        ];

        const runInput: ServicePipelineRunInput = {
          jobId: 'job_tamper_2',
          contractId: CONTRACT_ID,
          applicant: CONSUMER_PHARMA,
          serviceProtocol,
          queryStages: tamperedQuery,
          corpusRecords: syntheticCohortData,
          nodeUrn: TEE_NODE,
        };

        await expect(pipelineExecutor.executePipeline(runInput)).rejects.toThrow(
          '超出合约上限 90 天',
        );
      });

      it('包含 SQL 盲注或禁止谓词时当场阻断', async () => {
        const injectionQuery: PipelineStageQuery[] = [
          {
            stageId: 'step_filter',
            op: OP_FILTER,
            opDigest: OP_FILTER_SM3,
            params: {
              predicates: ['SELECT * FROM cohort WHERE 1=1 OR 1=1'],
            },
          },
          standardQueryStages[1],
        ];

        const runInput: ServicePipelineRunInput = {
          jobId: 'job_tamper_3',
          contractId: CONTRACT_ID,
          applicant: CONSUMER_PHARMA,
          serviceProtocol,
          queryStages: injectionQuery,
          corpusRecords: syntheticCohortData,
          nodeUrn: TEE_NODE,
        };

        await expect(pipelineExecutor.executePipeline(runInput)).rejects.toThrow(
          '包含合约明确禁止的谓词模式',
        );
      });

      it('算子哈希与合约白名单不一致（防止夹带恶意代码）时当场阻断', async () => {
        const tamperedOpQuery: PipelineStageQuery[] = [
          {
            stageId: 'step_filter',
            op: OP_FILTER,
            opDigest: 'c'.repeat(64), // 恶意算子哈希
            params: {},
          },
          standardQueryStages[1],
        ];

        const runInput: ServicePipelineRunInput = {
          jobId: 'job_tamper_4',
          contractId: CONTRACT_ID,
          applicant: CONSUMER_PHARMA,
          serviceProtocol,
          queryStages: tamperedOpQuery,
          corpusRecords: syntheticCohortData,
          nodeUrn: TEE_NODE,
        };

        await expect(pipelineExecutor.executePipeline(runInput)).rejects.toThrow(
          '算子完整性哈希不匹配',
        );
      });
    });

    describe('服务运行监督：频次控制、差分隐私预算耗尽与熔断器触发', () => {
      it('多次高频查询触发小时速率限制并自动熔断', () => {
        const queryTime = new Date('2026-09-27T10:00:00.000Z');

        // 第 1、2、3 次查询（达到限额 3 次/小时）
        for (let i = 0; i < 3; i++) {
          budgetLedger.chargeServiceBudget({
            contractId: CONTRACT_ID,
            applicant: CONSUMER_PHARMA,
            costEpsilon: 0.2,
            policy: serviceProtocol.budget_policy,
            now: queryTime,
          });
        }

        // 第 4 次查询同一小时内触发速率超限，并激活熔断保护
        expect(() =>
          budgetLedger.chargeServiceBudget({
            contractId: CONTRACT_ID,
            applicant: CONSUMER_PHARMA,
            costEpsilon: 0.2,
            policy: serviceProtocol.budget_policy,
            now: queryTime,
          }),
        ).toThrow('每小时调用速率超限');

        expect(budgetLedger.isCircuitBreakerTripped(CONTRACT_ID)).toBe(true);

        // 验证熔断状态下即使进入下一个时间窗口也持续阻断（fail-closed），需人工介入重置
        const laterTime = new Date('2026-09-27T15:00:00.000Z');
        expect(() =>
          budgetLedger.assertServiceBudgetWithin({
            contractId: CONTRACT_ID,
            applicant: CONSUMER_PHARMA,
            costEpsilon: 0.2,
            policy: serviceProtocol.budget_policy,
            now: laterTime,
          }),
        ).toThrow('服务计算已触发熔断');
      });

      it('全生命周期累积差分隐私预算 ε 耗尽后拒绝所有后续查询', () => {
        // 重置环境
        const cleanLedger = new NodeQueryBudgetLedger();

        // 一次性消耗 4.5 ε（上限 5.0）
        cleanLedger.chargeServiceBudget({
          contractId: 'contract_heavy_query',
          applicant: CONSUMER_PHARMA,
          costEpsilon: 4.5,
          policy: serviceProtocol.budget_policy,
        });

        // 再次请求 1.0 ε 导致 4.5 + 1.0 > 5.0，当场阻断且不产生扣减副作用
        expect(() =>
          cleanLedger.chargeServiceBudget({
            contractId: 'contract_heavy_query',
            applicant: CONSUMER_PHARMA,
            costEpsilon: 1.0,
            policy: serviceProtocol.budget_policy,
          }),
        ).toThrow('服务计算差分隐私预算不足');
      });
    });
  });

  describe('阶段 3：最终报告、交付即验证与合约终态清退', () => {
    it('执行轨迹 Merkle 树任何一步被篡改均导致离线验签失败', () => {
      const runInput: ServicePipelineRunInput = {
        jobId: 'job_report_verify',
        contractId: CONTRACT_ID,
        applicant: CONSUMER_PHARMA,
        serviceProtocol,
        queryStages: [
          {
            stageId: 'step_filter',
            op: OP_FILTER,
            opDigest: OP_FILTER_SM3,
            params: { filter_columns: ['active_therapy'], filter_column: 'active_therapy', filter_value: true },
          },
          {
            stageId: 'step_aggregate',
            op: OP_AGG,
            opDigest: OP_AGG_SM3,
            params: { grouping_columns: ['age_group'], grouping_column: 'age_group' },
          },
        ],
        corpusRecords: syntheticCohortData,
        nodeUrn: TEE_NODE,
        privateKey: nodeKeyPair.privateKey,
        now: NOW,
      };

      return pipelineExecutor.executePipeline(runInput).then((result) => {
        expect(result.witness).toBeDefined();

        // 离线验签真实凭证：通过
        expect(verifyTraceWitness(result.witness!, nodeKeyPair.publicKey)).toBe(true);

        // 模拟篡改：攻击者修改结果摘要试图伪造更低的患病率
        const tamperedWitness = {
          ...result.witness!,
          result_digest: canonicalSm3({ faked: 'lower_rate' }),
        };
        expect(verifyTraceWitness(tamperedWitness, nodeKeyPair.publicKey)).toBe(false);
      });
    });

    it('合约撤销或到期时，下发销毁指令彻底抹除语料密文并返回防篡改销毁回执', () => {
      // 托管语料
      corpusStore.put({
        corpusHandle: CORPUS_HANDLE,
        contractId: CONTRACT_ID,
        corpusId: CORPUS_ID,
        label: 'C2',
        digest: canonicalSm3(syntheticCohortData),
        envelope: { ciphertext: 'data_to_be_purged' },
        provider: PROVIDER_HOSP,
        registeredAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 86400000).toISOString(),
      });

      expect(corpusStore.get(CORPUS_HANDLE)).not.toBeNull();

      // 下发销毁指令
      const purgeReceipt = corpusStore.purge({
        contractId: CONTRACT_ID,
        corpusId: CORPUS_ID,
        reason: 'contract-revoked',
        idempotencyKey: `purge:${CONTRACT_ID}:${CORPUS_ID}`,
      });

      // 验证销毁回执的防篡改签名与字段完整性
      expect(purgeReceipt.receipt_id).toBe(`corpus-purge:${CONTRACT_ID}:${CORPUS_ID}`);
      expect(purgeReceipt.contract_id).toBe(CONTRACT_ID);
      expect(purgeReceipt.corpus_id).toBe(CORPUS_ID);
      expect(purgeReceipt.node).toBe(TEE_NODE);
      expect(purgeReceipt.sig.alg).toBe('SM2-SM3');
      expect(purgeReceipt.sig.value).toBeTruthy();

      // 验证语料已被物理移除
      expect(corpusStore.get(CORPUS_HANDLE)).toBeNull();

      // 重复销毁指令幂等返回同一回执
      const repeatReceipt = corpusStore.purge({
        contractId: CONTRACT_ID,
        corpusId: CORPUS_ID,
        reason: 'contract-revoked',
        idempotencyKey: `purge:${CONTRACT_ID}:${CORPUS_ID}`,
      });
      expect(repeatReceipt).toEqual(purgeReceipt);
    });
  });
});
