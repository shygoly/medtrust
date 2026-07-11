/**
 * Demo SM2 keys for federated LoRA consumer download (MVP / Fly demo only).
 * Production: load from participant registry / Vault, never commit private keys.
 */
export const DEMO_CONSUMER_SM2_KEYS: Record<
  string,
  { publicKey: string; privateKey: string; label: string }
> = {
  "pharma-hengrui": {
    label: "恒瑞医药 PV 研究员 (demo)",
    publicKey:
      "04ec900e082f12c1c70e37616d35a819d2214b948e56c0832ffbc8c6bf82853a1b0845f333dfdda1a9b871744a3aada5b0764357d5a9f19f8e7853a46694822e65",
    privateKey:
      "700ee30b9cde96d7241157fc7ca03b1abb4d4e17b297cc73c7620c57f197c2d5",
  },
};

export function consumerPublicKey(participantId: string): string | undefined {
  return DEMO_CONSUMER_SM2_KEYS[participantId]?.publicKey;
}
