import { createHash } from 'node:crypto';
import type { Tool } from '@medtrust/pi-agent';
import type { CardMessage } from '@medtrust/chat-cards';
import { asChatContext } from '../context';
import { findScenario, type ScenarioBuildContext } from '../scenarios';
import {
  buildScenarioFormCard,
  buildStatusCard,
} from '../../cards/card-builder';
import type { MedTrustApiClient } from './api-client';

const TOOL = '__registrationTool';

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const valuesFrom = (params: unknown): Record<string, unknown> =>
  record(record(params).values);

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bool = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

const numberValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const buildContext = (ctx: ReturnType<typeof asChatContext>): ScenarioBuildContext => ({
  spaceId: ctx.spaceId,
  userId: ctx.userId,
  directory: ctx.directory,
  defaults: ctx.defaults,
});

const nextCard = (
  title: string,
  description: string,
  values: Record<string, unknown>,
  nextTool: string,
): CardMessage => ({
  type: 'confirm',
  title,
  description,
  scenario: 'external-control-registration',
  data: {
    ...values,
    [TOOL]: nextTool,
  },
  actions: [
    { label: '继续', type: 'submit', variant: 'primary' },
    { label: '返回修改', type: 'back', variant: 'secondary' },
  ],
});

const failed = (
  error: string,
  values: Record<string, unknown>,
  suggestions: string[] = [],
) => ({
  success: false,
  error,
  data: {
    scenario: 'external-control-registration',
    values,
    card: {
      type: 'status' as const,
      title: '注册研究配置未通过',
      tone: 'error' as const,
      description: [error, ...suggestions].join('\n'),
      data: { SIMULATION_ONLY: 'boundary retained' },
    },
  },
});

export function buildRegistrationTools(api: MedTrustApiClient): Tool[] {
  const scenario = findScenario('external-control-registration');
  if (!scenario) throw new Error('external-control-registration scenario is not registered');

  const draftRegistrationStudy: Tool = {
    name: 'draft_registration_study',
    description: '创建注册研究草稿卡；研究编号和参数均来自用户或目录，不由模型编造。',
    parameters: {
      type: 'object',
      properties: {
        values: { type: 'object', description: '可选的已确认表单值' },
      },
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const card = buildScenarioFormCard({
        scenarioId: scenario.id,
        ctx: buildContext(ctx),
        defaultValues: valuesFrom(params),
        title: 'A02 · 注册研究草稿',
      });
      if (!card) return failed('无法生成注册研究表单', valuesFrom(params));
      return {
        success: true,
        data: {
          card,
          studyDraft: {
            schema: 'medtrust.rwd-registration-study-draft/v1',
            syntheticOnly: true,
          },
        },
      };
    },
  };

  const validateRegistrationProfile: Tool = {
    name: 'validate_registration_profile',
    description:
      '校验注册研究 profile、P0/SAP、合成边界和数据源选择；只返回确定性校验结果。',
    parameters: {
      type: 'object',
      properties: { values: { type: 'object' } },
      required: ['values'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const values = valuesFrom(params);
      const errors = scenario.validate(values, buildContext(ctx));
      if (errors.length > 0) return failed(errors.join('；'), values, ['已在卡片中保留你的原始输入。']);
      return {
        success: true,
        data: {
          card: nextCard(
            'A03 · Profile 已通过校验',
            'P0/SAP 结构与合成边界已确认。下一步由控制面解析每个数据源对应的有效合约。',
            values,
            'resolve_registration_sources',
          ),
          validation: {
            valid: true,
            syntheticOnly: bool(values.synthetic, true),
            p0DecisionsFrozen: bool(values.p0DecisionsFrozen),
          },
        },
      };
    },
  };

  const resolveRegistrationSources: Tool = {
    name: 'resolve_registration_sources',
    description:
      '从控制面合约列表解析试验方和外部对照方各自绑定的有效合约，不接受模型生成合约 ID。',
    parameters: {
      type: 'object',
      properties: { values: { type: 'object' } },
      required: ['values'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const values = valuesFrom(params);
      if (!ctx.accessToken) return failed('解析数据源合约需要当前用户授权', values, ['请重新登录后重试。']);
      let contracts;
      try {
        contracts = await api.listContracts(ctx.accessToken);
      } catch (error) {
        return failed(
          `无法读取合约目录：${error instanceof Error ? error.message : '控制面不可用'}`,
          values,
        );
      }
      const selected = [
        {
          role: 'trial',
          participant: text(values.trial),
          product: text(values.trialDataProduct),
          contractField: 'trialContract',
        },
        {
          role: 'external-control-primary',
          participant: text(values.primaryControl),
          product: text(values.primaryControlDataProduct),
          contractField: 'primaryControlContract',
        },
        ...(text(values.secondaryControl)
          ? [
              {
                role: 'external-control-secondary',
                participant: text(values.secondaryControl),
                product: text(values.secondaryControlDataProduct),
                contractField: 'secondaryControlContract',
              },
            ]
          : []),
      ];
      const resolved = { ...values };
      const sources: Array<Record<string, string>> = [];
      for (const source of selected) {
        const contract = contracts.find(
          (candidate) =>
            candidate.dataProductId === source.product &&
            candidate.mdopStatus === 'active' &&
            candidate.holderSigned === true &&
            (!candidate.validUntil || Date.parse(candidate.validUntil) > Date.now()) &&
            (!candidate.providerId || candidate.providerId === source.participant),
        );
        if (!contract) {
          return failed(
            `${source.role} 没有可用的有效合约`,
            values,
            [`请先为 ${source.participant || '(未选择参与方)'} / ${source.product || '(未选择数据产品)'} 完成合约签发。`],
          );
        }
        resolved[source.contractField] = contract.id;
        sources.push({
          role: source.role,
          participantId: source.participant,
          dataProductId: source.product,
          contractId: contract.id,
        });
      }
      return {
        success: true,
        data: {
          card: nextCard(
            'A04 · 数据源与合约已解析',
            `已从控制面解析 ${sources.length} 个数据源。卡片中的合约 ID 均来自服务端，不由模型生成。`,
            resolved,
            'review_registration_plan',
          ),
          sources,
          sourceDigest: `sha256:${digest(sources)}`,
        },
      };
    },
  };

  const reviewRegistrationPlan: Tool = {
    name: 'review_registration_plan',
    description: '按场景模板构建注册研究载荷并返回人工确认摘要与确定性载荷指纹。',
    parameters: {
      type: 'object',
      properties: { values: { type: 'object' } },
      required: ['values'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const values = valuesFrom(params);
      const errors = scenario.validate(values, buildContext(ctx));
      for (const field of ['trialContract', 'primaryControlContract'] as const)
        if (!text(values[field])) errors.push(`${field} 尚未从控制面解析`);
      if (text(values.secondaryControl) && !text(values.secondaryControlContract))
        errors.push('secondaryControlContract 尚未从控制面解析');
      if (errors.length > 0) return failed(errors.join('；'), values);
      const { submission, warnings } = scenario.buildSubmission(values, buildContext(ctx));
      const payloadFingerprint = `sha256:${digest(submission.payload)}`;
      const synthetic = bool(values.synthetic, true);
      return {
        success: true,
        data: {
          card: nextCard(
            'A05 · 统计与执行计划待确认',
            [
              'ATT、IPTW-ATT、协变量和数据源合约已绑定。',
              synthetic ? '下一步生成并锁定合成数据答案键。' : '下一步提交真实研究作业。',
              ...warnings,
            ].join('\n'),
            {
              ...values,
              __payloadFingerprint: payloadFingerprint,
            },
            synthetic ? 'prepare_synthetic_registration' : 'submit_external_control_registration',
          ),
          planReview: {
            design: 'single-arm-with-external-control',
            estimand: 'ATT',
            payloadFingerprint,
            warningCount: warnings.length,
          },
        },
      };
    },
  };

  const prepareSyntheticRegistration: Tool = {
    name: 'prepare_synthetic_registration',
    description:
      '确认合成数据演练、答案键 truthRr 与固定随机种子，生成可供报告追溯的摘要。',
    parameters: {
      type: 'object',
      properties: {
        values: { type: 'object' },
        seed: { type: 'number' },
      },
      required: ['values'],
    },
    execute: async (params) => {
      const values = valuesFrom(params);
      if (!bool(values.synthetic, true))
        return failed('该工具只用于合成数据演练；真实研究不得生成模拟答案键', values);
      const truthRr = numberValue(values.truthRr);
      if (!truthRr || truthRr <= 0) return failed('合成研究必须提供正数 truthRr', values);
      const seed = numberValue(record(params).seed) ?? 20261017;
      const answerKeyDigest = `sha256:${digest({
        studyId: text(values.studyId),
        seed,
        truthRr,
      })}`;
      return {
        success: true,
        data: {
          card: nextCard(
            'A06 · 合成数据演练已准备',
            '固定种子和答案键已锁定。作业与报告将持续标记 SIMULATION ONLY。',
            {
              ...values,
              syntheticSeed: seed,
              answerKeyDigest,
            },
            'submit_external_control_registration',
          ),
          syntheticPreparation: {
            seed,
            truthRr,
            answerKeyDigest,
            syntheticOnly: true,
          },
        },
      };
    },
  };

  const getRegistrationJob: Tool = {
    name: 'get_registration_job',
    description: '查询注册研究作业状态；只返回控制面事实，不推断执行成功。',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        values: { type: 'object' },
      },
      required: ['jobId'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const jobId = text(record(params).jobId);
      if (!jobId) return failed('jobId 不能为空', valuesFrom(params));
      try {
        const job = await api.getRegistrationJob(jobId, {
          userId: ctx.userId,
          spaceId: ctx.spaceId,
          ...(ctx.accessToken ? { token: ctx.accessToken } : {}),
        });
        const tone =
          job.status === 'SUCCEEDED'
            ? 'success'
            : job.status === 'FAILED' || job.status === 'REJECTED'
              ? 'error'
              : 'pending';
        return {
          success: true,
          data: {
            card: buildStatusCard('A08 · 注册研究作业状态', tone, {
              jobId: job.jobId,
              status: job.status,
              ...(job.planHash ? { planHash: job.planHash } : {}),
              ...(job.createdAt ? { createdAt: job.createdAt } : {}),
            }),
            job,
          },
        };
      } catch (error) {
        return failed(
          `查询作业失败：${error instanceof Error ? error.message : '控制面不可用'}`,
          { ...valuesFrom(params), jobId },
        );
      }
    },
  };

  const buildRegistrationReport: Tool = {
    name: 'build_registration_report',
    description:
      '调用控制面从作业证据与已登记的助手会话构建报告；不接受助手生成的研究数字。',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        reportInput: { type: 'object' },
      },
      required: ['jobId'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const input = record(params);
      const jobId = text(input.jobId);
      if (!jobId) return failed('jobId 不能为空', {});
      try {
        const reportInput =
          typeof input.reportInput === 'object' && input.reportInput !== null
            ? record(input.reportInput)
            : undefined;
        const report = await api.buildRegistrationReport(jobId, reportInput, {
          userId: ctx.userId,
          spaceId: ctx.spaceId,
          ...(ctx.accessToken ? { token: ctx.accessToken } : {}),
        });
        return {
          success: true,
          data: {
            card: {
              type: 'result',
              title: report.syntheticOnly
                ? 'A09 · 模拟注册研究报告已生成'
                : 'A09 · 注册研究报告已生成',
              description: '报告数字、哈希和指纹均来自控制面 canonical JSON。',
              data: {
                jobId: report.jobId,
                reportFingerprint: report.reportFingerprint,
                SIMULATION_ONLY: report.syntheticOnly ? 'YES' : 'NO',
                json: report.files.json,
                markdown: report.files.markdown,
                html: report.files.html,
                docx: report.files.docx,
                evidenceZip: report.files.evidenceZip,
              },
            },
            report,
          },
        };
      } catch (error) {
        return failed(
          `报告生成失败：${error instanceof Error ? error.message : '控制面不可用'}`,
          { jobId },
        );
      }
    },
  };

  const downloadRegistrationReport: Tool = {
    name: 'download_registration_report',
    description: '生成注册研究报告下载卡；链接由控制面提供，标签持续显示模拟边界。',
    parameters: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        syntheticOnly: { type: 'boolean' },
      },
      required: ['jobId'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const input = record(params);
      const jobId = text(input.jobId);
      if (!jobId) return failed('jobId 不能为空', {});
      if (!ctx.accessToken) return failed('下载报告需要当前用户授权', { jobId }, ['请重新登录后重试。']);
      const syntheticOnly = bool(input.syntheticOnly, false);
      return {
        success: true,
        data: {
          card: {
            type: 'result',
            title: syntheticOnly
              ? 'A10 · 下载模拟注册研究报告'
              : 'A10 · 下载注册研究报告',
            description: syntheticOnly
              ? 'SIMULATION ONLY — 下载文件仅用于合成演练，不得作为临床或监管证据。'
              : '文件访问权限由控制面按作业结果权限复核。',
            data: {
              jobId,
              json: api.registrationReportDownloadUrl(jobId, 'json'),
              markdown: api.registrationReportDownloadUrl(jobId, 'markdown'),
              html: api.registrationReportDownloadUrl(jobId, 'html'),
              docx: api.registrationReportDownloadUrl(jobId, 'docx'),
              evidenceZip: api.registrationReportDownloadUrl(jobId, 'evidence-zip'),
            },
          },
        },
      };
    },
  };

  return [
    draftRegistrationStudy,
    validateRegistrationProfile,
    resolveRegistrationSources,
    reviewRegistrationPlan,
    prepareSyntheticRegistration,
    getRegistrationJob,
    buildRegistrationReport,
    downloadRegistrationReport,
  ];
}

export function registrationToolFromValues(
  values: Record<string, unknown>,
): string | undefined {
  const tool = values[TOOL];
  return typeof tool === 'string' ? tool : undefined;
}
