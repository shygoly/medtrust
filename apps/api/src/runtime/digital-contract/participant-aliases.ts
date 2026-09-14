/** Demo / seed IDs may use slug or org display name — match both sides. */
const PARTICIPANT_ALIASES: Record<string, string[]> = {
  "p-huashan": ["p-huashan", "华山医院", "hospital-huashan"],
  "p-ruijin": ["p-ruijin", "瑞金医院", "hospital-ruijin"],
  "p-zhongshan": ["p-zhongshan", "中山医院", "hospital-zhongshan"],
  "p-meddata": ["p-meddata", "医研数据研究院", "创新药企", "pharma-demo"],
  "p-smartmed": ["p-smartmed", "智慧医疗AI"],
};

export function participantMatches(
  actorId: string | undefined,
  partyId: string,
): boolean {
  if (!actorId) return false;
  if (actorId === partyId) return true;
  const aliases = PARTICIPANT_ALIASES[actorId] ?? [actorId];
  if (aliases.includes(partyId)) return true;
  // Reverse: partyId is a slug key
  const partyAliases = PARTICIPANT_ALIASES[partyId] ?? [];
  return partyAliases.includes(actorId);
}
