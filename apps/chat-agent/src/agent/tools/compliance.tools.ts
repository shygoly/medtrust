import type { Tool, ToolContext } from '@medtrust/pi-agent';
import { asChatContext } from '../context';
import type { MedTrustApiClient } from './api-client';
import { checkContractGate, checkMembership } from '../../compliance/compliance';
import { checkDataAccess } from '../../compliance/compliance';
import { buildContractGateCard } from '../../cards/contract-cards';
import { buildContractRequestCard } from '../../cards/card-builder';

/**
 * 合规类工具（Phase 1-2）。
 *
 * 命名诚实：控制面**没有"数据产品级访问检查"端点**（不存在 `checkDataAccess`），
 * 所以这里不造一个假的 `check_data_access`，而是提供两个**真的能回答**的问题：
 * - `check_space_membership`：你是不是这个空间的成员、什么角色
 * - `check_contract_status`：覆盖这些参与方的合约是否能过控制面的准入判据
 *
 * 产品级访问由控制面的 SpaceGuard / 合约覆盖共同承担，agent 侧只做**提前告知**。
 */
export function buildComplianceTools(api: MedTrustApiClient): Tool[] {
  return [
    {
      name: 'check_data_access',
      description:
        '检查某个数据产品是否已授权给当前用户所在的参与方（产品级访问授权，D-ACL-1）。' +
        '返回 allowed 与原因（no-grant / revoked / expired / permission-missing / purpose-mismatch）。' +
        '被拒时结果里带一张现成的卡（data.card）：原样输出它，不要自己编授权或承诺"我可以帮你开权限"。',
      parameters: {
        type: 'object',
        properties: {
          dataProductId: { type: 'string', description: '数据产品 id' },
          purpose: { type: 'string', description: '作业用途编码（与授权/合约的用途比对）' },
        },
        required: ['dataProductId'],
      },
      execute: async (params, context: ToolContext) => {
        const ctx = asChatContext(context);
        const dataProductId = String((params as { dataProductId?: unknown }).dataProductId ?? '');
        if (!dataProductId.trim()) return { success: false, error: 'dataProductId 不能为空' };
        const purpose =
          typeof (params as { purpose?: unknown }).purpose === 'string'
            ? String((params as { purpose?: unknown }).purpose)
            : ctx.draft?.purposeCode ?? ctx.scenario?.purposePolicy.default;

        const gate = await checkDataAccess(api, ctx.accessToken, [dataProductId], purpose);
        if (!gate || gate.status === 'unknown') {
          return {
            success: true,
            data: { dataProductId, allowed: null, reason: 'unknown', note: '查询不可用，交由控制面判定' },
          };
        }
        if (gate.status === 'allowed') {
          return { success: true, data: { dataProductId, allowed: true, reason: 'allowed' } };
        }
        return {
          success: false,
          error: gate.reason,
          data: {
            dataProductId,
            allowed: false,
            fix: gate.fix ?? null,
            card: buildContractRequestCard({
              title: '还没有这个数据产品的访问授权',
              reason: gate.reason ?? '控制面判定未授权',
              steps: [
                '把这份需求发给数据提供方，请其授予访问权',
                '或联系空间管理员/合规方代授',
                '授权生效后回来说一声，我重新检查',
              ],
            }),
          },
        };
      },
    },
    {
      name: 'check_space_membership',
      description:
        '查询当前用户是否是某空间的成员及其角色（数据提供方/使用方/运营/合规/管理员）。' +
        '在替用户配置任务前可用它确认权限。',
      parameters: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: '空间 id；缺省用当前空间' },
        },
      },
      execute: async (params, context: ToolContext) => {
        const ctx = asChatContext(context);
        const spaceId = String((params as { spaceId?: unknown }).spaceId ?? '') || ctx.spaceId;
        const result = await checkMembership(api, ctx.accessToken, spaceId);
        return {
          success: result.status !== 'no',
          data: { spaceId, isMember: result.status === 'yes', role: result.role ?? null },
          ...(result.reason ? { error: result.reason } : {}),
        };
      },
    },
    {
      name: 'check_contract_status',
      description:
        '按数据源依赖逐项检查合约是否可用（存在、持有方已签名、MDOP 状态 active、未过期、用途编码相符）。' +
        '每项必须同时给 participantId 与 dataProductId；双数据源场景一次传两项，缺一份就返回完整合约包。' +
        '不可用时结果里会带一张 **现成的卡（data.card）**：请把它原样输出，不要自己编合约 id 或参与方。',
      parameters: {
        type: 'object',
        properties: {
          requirements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', description: '场景角色，如 trial / controls' },
                participantId: { type: 'string' },
                dataProductId: { type: 'string' },
              },
              required: ['participantId', 'dataProductId'],
            },
            description: '本次作业的逐数据源合约依赖',
          },
          purpose: { type: 'string', description: '作业用途编码（与合约 purposeCode 比对）' },
          dataProductId: {
            type: 'string',
            description: '要申请的数据产品 id（给了才能在"需要申请合约"时生成申请卡）',
          },
          validDays: { type: 'number', description: '申请有效期（天），缺省 30' },
        },
        required: ['requirements'],
      },
      execute: async (params, context: ToolContext) => {
        const ctx = asChatContext(context);
        const raw = (params as { requirements?: unknown }).requirements;
        let requirements = Array.isArray(raw)
          ? raw
              .filter(
                (item): item is Record<string, unknown> =>
                  typeof item === 'object' && item !== null,
              )
              .map((item) => ({
                ...(typeof item.role === 'string' ? { role: item.role } : {}),
                participantId: String(item.participantId ?? '').trim(),
                dataProductId: String(item.dataProductId ?? '').trim(),
              }))
              .filter((item) => item.participantId && item.dataProductId)
          : [];
        const legacyParticipantsRaw = (params as { participants?: unknown }).participants;
        const legacyParticipants = Array.isArray(legacyParticipantsRaw)
          ? legacyParticipantsRaw.filter(
              (item): item is string => typeof item === 'string' && item.length > 0,
            )
          : [];
        if (requirements.length === 0 && legacyParticipants.length > 0) {
          const legacyProduct =
            typeof (params as { dataProductId?: unknown }).dataProductId === 'string'
              ? String((params as { dataProductId?: unknown }).dataProductId)
              : '';
          requirements = legacyParticipants.map((participantId) => ({
            participantId,
            dataProductId: legacyProduct,
          }));
        }
        if (requirements.length === 0) {
          return {
            success: false,
            error: 'requirements 不能为空（每项需 participantId + dataProductId）',
          };
        }
        const participants = [...new Set(requirements.map((item) => item.participantId))];
        const purpose =
          typeof (params as { purpose?: unknown }).purpose === 'string'
            ? String((params as { purpose?: unknown }).purpose)
            : ctx.draft?.purposeCode ?? ctx.scenario?.purposePolicy.default;
        const dataProductId =
          typeof (params as { dataProductId?: unknown }).dataProductId === 'string'
            ? String((params as { dataProductId?: unknown }).dataProductId)
            : undefined;
        const validDaysRaw = Number((params as { validDays?: unknown }).validDays);
        const validDays =
          Number.isFinite(validDaysRaw) && validDaysRaw >= 1 && validDaysRaw <= 365
            ? Math.floor(validDaysRaw)
            : undefined;

        const gate = await checkContractGate(api, ctx.accessToken, {
          participants,
          ...(requirements.every((item) => item.dataProductId)
            ? { requirements }
            : {}),
          ...(purpose ? { purpose } : {}),
        });
        const card = buildContractGateCard(gate, {
          purpose: purpose ?? '数据使用',
          participants,
          directory: ctx.directory,
          ...(ctx.draft?.scenarioId ? { scenarioId: ctx.draft.scenarioId } : {}),
          ...(ctx.scenario ? { requestDefaults: ctx.scenario.contractRequestDefaults } : {}),
          ...(dataProductId ? { dataProductId } : {}),
          ...(validDays ? { validDays } : {}),
        });
        return {
          success: gate.status === 'usable' || gate.status === 'unknown',
          data: {
            status: gate.status,
            contractId: gate.contractId ?? null,
            contractStatus: gate.contractStatus ?? null,
            fix: gate.fix ?? null,
            requirements: gate.requirementGates ?? [],
            contractBundle: gate.contractBundle ?? null,
            ...(card ? { card } : {}),
          },
          ...(gate.reason ? { error: gate.reason } : {}),
        };
      },
    },
  ];
}
