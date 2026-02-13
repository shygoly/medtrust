export interface VaultConfig {
  address: string;
  token: string;
  namespace?: string;
  apiVersion?: string;
  cacheTTLSeconds?: number;
}

export interface CachedKey {
  key: string;
  expiresAt: number;
}

export interface VaultKVResponse {
  data: {
    data: Record<string, any>;
    metadata: Record<string, any>;
  };
}
