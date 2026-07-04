export interface ApiAttestation {
  id: number;
  attestation_type?: string;
  status?: string;
  data_id?: string | null;
  data_hash?: string;
  transaction_hash?: string | null;
  block_number?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface AttestationRow {
  id: number;
  type: string;
  status: string;
  dataId: string;
  dataHash: string;
  txHash: string;
  blockNumber: number | null;
  metadataSummary: string;
}

export function toAttestationRows(attestations: ApiAttestation[]): AttestationRow[] {
  return attestations.map((item) => ({
    id: item.id,
    type: String(item.attestation_type ?? "custom").toUpperCase(),
    status: String(item.status ?? "unknown").toUpperCase(),
    dataId: item.data_id || `ATTESTATION-${item.id}`,
    dataHash: item.data_hash ?? "",
    txHash: item.transaction_hash || "pending",
    blockNumber: typeof item.block_number === "number" ? item.block_number : null,
    metadataSummary: summarizeMetadata(item.metadata),
  }));
}

function summarizeMetadata(metadata: ApiAttestation["metadata"]): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "none";
  const entries = Object.entries(metadata);
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(" · ");
}
