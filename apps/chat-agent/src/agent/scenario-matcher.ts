import { SCENARIOS, type ScenarioDefinition } from './scenarios';

export interface ScenarioMatch {
  scenario: ScenarioDefinition;
  score: number;
  matchedKeywords: string[];
}

const normalize = (text: string): string => text.toLowerCase();

/**
 * 关键词打分匹配（FR-1 场景识别）。
 *
 * 这是**确定性**的实现，既服务于无 LLM 的回退模式，也在有 LLM 时作为
 * 提示词里的候选清单来源。打分口径：
 *   +3  命中场景自身 id
 *   +2  命中长关键词（≥2 字）—— 长词区分度高
 *   +1  命中短关键词
 * 平手按 SCENARIOS 声明顺序（稳定的 top-N）。
 */
export function matchScenarios(text: string, topN = 3): ScenarioMatch[] {
  const haystack = normalize(text ?? '');
  if (!haystack.trim()) return [];

  const matches: ScenarioMatch[] = SCENARIOS.map((scenario) => {
    let score = 0;
    const matchedKeywords: string[] = [];
    if (haystack.includes(normalize(scenario.id))) {
      score += 3;
      matchedKeywords.push(scenario.id);
    }
    for (const keyword of scenario.keywords) {
      const needle = normalize(keyword);
      if (needle.length === 0) continue;
      if (haystack.includes(needle)) {
        score += needle.length >= 2 ? 2 : 1;
        matchedKeywords.push(keyword);
      }
    }
    return { scenario, score, matchedKeywords };
  })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || SCENARIOS.indexOf(a.scenario) - SCENARIOS.indexOf(b.scenario));

  return matches.slice(0, topN);
}

/** 唯一最高分且领先第二名 ≥1 分时才算「明确识别」。 */
export function bestScenario(text: string): ScenarioMatch | null {
  const matches = matchScenarios(text, 2);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return matches[0].score > matches[1].score ? matches[0] : null;
}
