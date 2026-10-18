import type { AssistantIntent } from './assistant-intent';
import { findScenario, type ScenarioDefinition } from './scenarios';

export interface ScenarioContractDependency {
  role: string;
  participantId: string;
  dataProductId: string;
}

export interface ScenarioContractBundleStatus {
  status: 'ready' | 'needs_contract' | 'needs_data_access' | 'unknown';
  bundleId?: string;
  bundleVersion?: string;
  contractIds: string[];
  updatedAt: string;
}

export interface ScenarioDraft {
  scenarioId: string;
  assistantIntent: AssistantIntent;
  values: Record<string, unknown>;
  purposeCode: string;
  contractDependencies: ScenarioContractDependency[];
  contractBundle?: ScenarioContractBundleStatus;
  status: 'collecting' | 'checking' | 'ready' | 'needs_contract' | 'submitted' | 'failed';
  context?: {
    objectType: string;
    objectId: string;
    page: string;
    status?: string;
  };
  updatedAt: string;
}

export function buildScenarioDraft(
  scenario: ScenarioDefinition,
  assistantIntent: AssistantIntent,
  values: Record<string, unknown>,
  now = new Date(),
): ScenarioDraft {
  const contractDependencies = scenario.contractDependencies.map((dependency) => ({
    role: dependency.role,
    participantId: String(values[dependency.participantField] ?? '').trim(),
    dataProductId: String(values[dependency.dataProductField] ?? '').trim(),
  }));
  const complete = contractDependencies.every(
    (dependency) => dependency.participantId && dependency.dataProductId,
  );
  return {
    scenarioId: scenario.id,
    assistantIntent,
    values: { ...values },
    purposeCode: scenario.purposePolicy.default,
    contractDependencies,
    status: complete ? 'checking' : 'collecting',
    updatedAt: now.toISOString(),
  };
}

export function updateScenarioDraftStatus(
  draft: ScenarioDraft,
  patch: Partial<
    Pick<ScenarioDraft, 'status' | 'contractBundle' | 'purposeCode' | 'assistantIntent'>
  >,
  now = new Date(),
): ScenarioDraft {
  return {
    ...draft,
    ...patch,
    updatedAt: now.toISOString(),
  };
}

export function attachDraftContext(
  draft: ScenarioDraft | undefined,
  assistantIntent: AssistantIntent,
  context: { objectType: string; objectId: string; page: string; status?: string },
  now = new Date(),
): ScenarioDraft {
  if (draft)
    return {
      ...draft,
      assistantIntent,
      context,
      updatedAt: now.toISOString(),
    };
  return {
    scenarioId: 'unselected',
    assistantIntent,
    values: {},
    purposeCode: '对话式任务配置（AI Chat Agent）',
    contractDependencies: [],
    status: 'collecting',
    context,
    updatedAt: now.toISOString(),
  };
}

export function resolveContractRequirements(
  scenarioId: string,
  values: Record<string, unknown>,
): ScenarioContractDependency[] {
  const scenario = findScenario(scenarioId);
  if (!scenario) return [];
  return buildScenarioDraft(scenario, scenario.assistantIntent, values).contractDependencies;
}
