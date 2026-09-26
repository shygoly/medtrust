import { registerAs } from "@nestjs/config";

export interface SecurityConfig {
  vault: {
    address: string;
    token: string;
    cacheTTLSeconds: number;
  };
  audit: {
    logUnmaskedAccess: boolean;
  };
}

export default registerAs("security", (): SecurityConfig => ({
  vault: {
    address: process.env.VAULT_ADDR || "http://localhost:8200",
    token: process.env.VAULT_TOKEN || "",
    cacheTTLSeconds: parseInt(process.env.KEY_CACHE_TTL_SECONDS || "300", 10),
  },
  audit: {
    logUnmaskedAccess: process.env.AUDIT_LOG_UNMASKED_ACCESS === "true",
  },
}));
