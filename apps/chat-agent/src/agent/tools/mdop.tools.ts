import type { Tool } from '@medtrust/pi-agent';
import {
  collectDataProducts,
  collectParticipants,
  evaluatePrerequisites,
  submissionPurpose,
} from '../../compliance/compliance';
import { asChatContext } from '../context';
import { buildScenarioFormCard } from '../../cards/card-builder';
import { buildContractRequestCard } from '../../cards/card-builder';
import { buildContractGateCard } from '../../cards/contract-cards';
import { findScenario, type ScenarioDefinition } from '../scenarios';
import type { SpaceDirectory } from '../directory';
import type { MedTrustApiClient } from './api-client';

/**
 * 场景中「参与方 + 数据产品」的显式绑定。
 *
 * 依赖由 ScenarioDefinition.contractDependencies 声明，工具不再按场景 id 硬编码；
 * 外部对照的试验臂与对照臂会各自生成一条 requirement。
 */
function csvValues(value: unknown): string[] {
  return String(value ?? '')
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function contractRequirements(
  scenario: ScenarioDefinition,
  values: Record<string, unknown>,
  directory: SpaceDirectory,
): Array<{ role: string; participantId: string; dataProductId: string }> {
  const selectedContractIds = [
    String(values.trialContractId ?? '').trim(),
    String(values.controlsContractId ?? '').trim(),
  ].filter(Boolean);
  if (selectedContractIds.length > 0) {
    return selectedContractIds
      .map((contractId, index) => {
        const contract = directory.contracts?.find((item) => item.id === contractId);
        if (!contract?.dataProductId) return null;
        return {
          role: index === 0 ? 'trial' : 'controls',
          participantId: contract.providerId,
          dataProductId: contract.dataProductId,
        };
      })
      .filter((item): item is { role: string; participantId: string; dataProductId: string } => Boolean(item));
  }
  if (scenario.contractDependencies.length > 0) {
    return scenario.contractDependencies
      .map((dependency) => ({
        role: dependency.role,
        participantId: String(values[dependency.participantField] ?? '').trim(),
        dataProductId: String(values[dependency.dataProductField] ?? '').trim(),
      }))
      .filter((dependency) => dependency.participantId && dependency.dataProductId);
  }
  // 模板场景（电力负荷预测/需求响应/窃电检测）没有固定的 contractDependencies：
  // 参与方与数据产品由用户在卡片里逐项填写。这里按同一顺序配对，作为合约前置闸的
  // 要求；否则 gate 只会挑到第一份合约，其余节点的本地复核拿不到自己的副本。
  const participants = csvValues(values.participants);
  const dataProducts = csvValues(values.dataProducts);
  if (participants.length === 0 || dataProducts.length === 0) return [];
  return participants.map((participantId, index) => ({
    role: 'source',
    participantId,
    dataProductId: dataProducts[index] ?? dataProducts[0]!,
  }));
}

/**
 * 每个场景一个 submit 工具（工具名与 spec FR-3 一致）。
 * 参数统一为 `{ values }`：values 就是 Card 表单回灌的那份，避免与卡片字段二次漂移。
 */
export function buildSubmitTool(
  scenario: ScenarioDefinition,
  api: MedTrustApiClient,
): Tool {
  return {
    name: scenario.toolName,
    description: `提交「${scenario.title}」作业：${scenario.description}`,
    parameters: {
      type: 'object',
      properties: {
        values: {
          type: 'object',
          description: 'Card 表单提交的 values 对象（原样透传，不要增删字段）',
        },
      },
      required: ['values'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const values =
        typeof params === 'object' && params !== null
          ? ((params as { values?: unknown }).values ?? {})
          : {};
      const valuesObject =
        typeof values === 'object' && values !== null
          ? (values as Record<string, unknown>)
          : {};

      const buildContext = {
        spaceId: ctx.spaceId,
        userId: ctx.userId,
        directory: ctx.directory,
        defaults: ctx.defaults,
      };

      const errors = scenario.validate(valuesObject, buildContext);
      if (errors.length > 0) {
        // 必须带上 values：上层据此把「填过的值」放回一张预填卡片。
        // 早先这里只回 scenario，于是**校验失败**（最需要改一处再提交的场景）反而拿不到回卡，
        // 只有 API 失败那条路径有 —— 是 E2E 演示用例暴露出来的。
        return {
          success: false,
          error: errors.join('；'),
          data: { scenario: scenario.id, values: valuesObject },
        };
      }

      const { submission, warnings } = scenario.buildSubmission(valuesObject, buildContext);

      // ── 合规前置闸（ai-chat-agent-compliance-integration Phase 1-2）─────────────
      // 在**打控制面之前**把"还差什么"讲清楚。控制面的准入判据是（assertUsableForJob）：
      // 合约存在 → 持有方签名 → mdopStatus=active → 未过期 → 用途编码相符。
      // 查不动时返回 unknown **不拦**：查询故障不等于无权限，真正的强制点在控制面。
      const purpose = submissionPurpose(submission);
      const gate = await evaluatePrerequisites(api, {
        ...(ctx.accessToken ? { token: ctx.accessToken } : {}),
        spaceId: ctx.spaceId,
        participants: collectParticipants(submission),
        dataProductIds: collectDataProducts(submission),
        requirements: contractRequirements(scenario, valuesObject, ctx.directory),
        ...(purpose ? { purpose } : {}),
      });

      if (
        gate.status === 'needs_permission' ||
        gate.status === 'needs_data_access' ||
        gate.status === 'needs_contract'
      ) {
        // 拦下来时**连卡一起给**：卡片内容由工具按判定与目录确定性生成，
        // 模型只负责原样输出（编不出 contractId / 参与方），确定性回退也能跑通。
        const participants = collectParticipants(submission);
        const dataProductId = collectDataProducts(submission)[0];
        const compositions =
          gate.status === 'needs_contract' && ctx.accessToken
            ? await api.listCompositions(ctx.accessToken).catch(() => [])
            : [];
        const contractCard =
          gate.status === 'needs_contract' && participants.length > 0
            ? buildContractGateCard(gate.contract, {
                purpose: purpose ?? scenario.title,
                participants,
                directory: ctx.directory,
                scenarioId: scenario.id,
                requestDefaults: scenario.contractRequestDefaults,
                compositions: compositions.map((c) => ({ id: c.id, verdict: c.verdict })),
                preReviewUrl: '/space/atlas/pre-review',
                ...(dataProductId ? { dataProductId } : {}),
              })
            : undefined;
        // 访问授权缺失（产品级 ACL，D-ACL-1）：agent 替不了——授权只能由产品提供方
        // （或合规/运营）授予。给"去找谁开权限"的引导卡，不给可点的假动作。
        const accessCard =
          gate.status === 'needs_data_access'
            ? buildContractRequestCard({
                title: '还没有这个数据产品的访问授权',
                reason: gate.reason ?? '控制面判定该数据产品未授权给你所在参与方',
                steps: [
                  '把这份需求发给数据提供方（医院/数据持有方），请其授予访问权',
                  '或联系空间管理员/合规方代授（平台侧有代授权限）',
                  '授权生效后回来说一声，我重新检查并继续配置',
                ],
                ...(dataProductId
                  ? {
                      contract: {
                        purpose: purpose ?? scenario.title,
                        dataProducts: [{ participantId: '', dataProductId }],
                        autoApprove: false,
                      },
                    }
                  : {}),
              })
            : undefined;
        const nextCard = contractCard ?? accessCard;
        return {
          success: false,
          error: gate.reason ?? '合规先决条件不满足',
          // 带上 values：上层据此出「预填回卡」，用户改一处即可重提
          data: {
            scenario: scenario.id,
            values: valuesObject,
            compliance: {
              status: gate.status,
              fix: gate.fix ?? null,
              contractId: gate.contractId ?? null,
            },
            ...(nextCard ? { card: nextCard } : {}),
          },
        };
      }

      // 查到可用合约而载荷里没带 → 补上（用户自己那份合约、用用户的授权提交）
      if (gate.status === 'ready' && gate.contractId) {
        const contracts = gate.contractIds ?? [gate.contractId];
        const payload = submission.payload as Record<string, unknown> | undefined;
        const current = Array.isArray(payload?.contracts) ? payload.contracts : [];
        if (payload && current.length === 0) {
          payload.contracts = contracts;
        }
        // template 模式：合约在 templateInput 里，不在 payload 里。
        const templateInput = submission.templateInput as Record<string, unknown> | undefined;
        const templateContracts = Array.isArray(templateInput?.contracts)
          ? templateInput.contracts
          : [];
        if (templateInput && templateContracts.length === 0) {
          templateInput.contracts = contracts;
        }
        const allocations = gate.contract.allocations;
        if (payload && submission.scenarioId === 'external-control' && allocations?.length) {
          payload.contractsByParticipant = Object.fromEntries(
            allocations.map((item) => [item.participantId, item.contractId]),
          );
          if (gate.contractBundle?.bundleId && gate.contractBundle.version) {
            payload.contractBundle = {
              id: gate.contractBundle.bundleId,
              version: gate.contractBundle.version,
              minCell: scenario.contractRequestDefaults.minCell,
            };
          }
          payload.contractBindings = allocations.map((item) => {
            const suffix = item.participantId.replace(/[^A-Za-z0-9]/g, '');
            return {
              contractId: item.contractId,
              participantId: item.participantId,
              dataProductId: item.dataProductId,
              role: item.role ?? 'source',
              stages: [`src_${suffix}`, `seal_${suffix}`],
            };
          });
        }
      }

      try {
        const result = await api.submitScenario(submission, {
          userId: ctx.userId,
          spaceId: ctx.spaceId,
          ...(ctx.accessToken ? { token: ctx.accessToken } : {}),
        });
        return {
          success: true,
          // contractId 随结果一起回给上层：任务与授权在数据上对齐（plan 成功指标
          // "100% 的任务提交都有关联合约"），也是结果卡上"用了哪份授权"的来源。
          data: {
            ...result,
            title: scenario.title,
            scenario: scenario.id,
            contractId: gate.contractId ?? null,
            contractIds: gate.contractIds ?? (gate.contractId ? [gate.contractId] : []),
            compliance: {
              status: gate.status,
              contractId: gate.contractId ?? null,
              contractIds: gate.contractIds ?? (gate.contractId ? [gate.contractId] : []),
            },
          },
          metadata: { warnings },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '任务提交失败',
          data: { scenario: scenario.id, values: valuesObject },
        };
      }
    },
  };
}

/** 供「卡片参数修正」工具复用：重新出一张同场景的卡片。 */
export function buildRefreshCardTool(scenarios: ScenarioDefinition[]): Tool {
  return {
    name: 'refresh_scenario_card',
    description: '重新生成某个场景的参数卡片（用户要改参数时用）',
    parameters: {
      type: 'object',
      properties: {
        scenarioId: {
          type: 'string',
          description: '场景 id',
          enum: scenarios.map((scenario) => scenario.id),
        },
      },
      required: ['scenarioId'],
    },
    execute: async (params, context) => {
      const ctx = asChatContext(context);
      const scenarioId = String((params as { scenarioId?: unknown })?.scenarioId ?? '');
      if (!findScenario(scenarioId)) return { success: false, error: `未知场景：${scenarioId}` };
      const card = buildScenarioFormCard({
        scenarioId,
        ctx: {
          spaceId: ctx.spaceId,
          userId: ctx.userId,
          directory: ctx.directory,
          defaults: ctx.defaults,
        },
      });
      if (!card) return { success: false, error: `无法生成 ${scenarioId} 的卡片` };
      return { success: true, data: card };
    },
  };
}
