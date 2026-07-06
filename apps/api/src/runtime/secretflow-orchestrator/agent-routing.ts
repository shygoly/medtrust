/** Resolve gRPC endpoints per hospital participant (multi-connector federated demo). */

const DEFAULT_ENDPOINT = process.env.AGENT_GRPC_URL || '127.0.0.1:5024';

function routingMap(): Map<string, string> {
  const map = new Map<string, string>();
  const raw = process.env.AGENT_GRPC_ROUTING || '';
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    map.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return map;
}

export function agentEndpointFor(participantId?: string): string {
  if (participantId) {
    const hit = routingMap().get(participantId);
    if (hit) return hit;
  }
  return DEFAULT_ENDPOINT;
}

export function providerEndpoints(spec: { parties: Array<{ participantId: string; role: string }> }): Map<string, string> {
  const out = new Map<string, string>();
  for (const party of spec.parties) {
    if (party.role !== 'provider') continue;
    out.set(party.participantId, agentEndpointFor(party.participantId));
  }
  return out;
}

export function agentLogStreamUrl(participantId: string, taskId: string): string {
  const endpoint = agentEndpointFor(participantId);
  const host = endpoint.includes(':') ? endpoint.split(':')[0] : endpoint;
  return `ws://${host}:5023/logs/${taskId}`;
}

export function isMultiConnectorFederation(
  spec: { parties: Array<{ participantId: string; role: string }> },
): boolean {
  const endpoints = new Set([...providerEndpoints(spec).values()]);
  return endpoints.size > 1;
}
