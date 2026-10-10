/** Match API participant-aliases for UI gating */
const PARTICIPANT_ALIASES: Record<string, string[]> = {
  'p-demohospa': ['p-demohospa', '示范甲医院', 'hospital-demohospa'],
  'p-demohospb': ['p-demohospb', '示范乙医院', 'hospital-demohospb'],
  'p-demohospc': ['p-demohospc', '示范丙医院', 'hospital-demohospc'],
  'p-meddata': ['p-meddata', '医研数据研究院', '创新药企', 'pharma-demo'],
  'p-smartmed': ['p-smartmed', '智慧医疗AI'],
};

export function participantMatches(actorId: string | undefined, partyId: string): boolean {
  if (!actorId) return false;
  if (actorId === partyId) return true;
  const aliases = PARTICIPANT_ALIASES[actorId] ?? [actorId];
  if (aliases.includes(partyId)) return true;
  const partyAliases = PARTICIPANT_ALIASES[partyId] ?? [];
  return partyAliases.includes(actorId);
}
