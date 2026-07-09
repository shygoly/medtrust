export function toAttestationRows(attestations) {
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

function summarizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "none";
  const entries = Object.entries(metadata);
  if (entries.length === 0) return "none";
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(" · ");
}
