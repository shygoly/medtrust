import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as vault from 'node-vault';
import { sm2 } from 'sm-crypto';

export interface AttestationKey {
  privateKey: string;
  publicKey: string;
  address: string;
}

@Injectable()
export class VaultKeyService {
  private readonly logger = new Logger(VaultKeyService.name);
  private vaultClient: any;
  private keyCache: Map<string, { key: AttestationKey; cachedAt: Date }> = new Map();
  private readonly cacheTtl = 300000; // 5 minutes

  constructor(private readonly configService: ConfigService) {
    this.initializeVault();
  }

  private initializeVault(): void {
    const vaultAddr = this.configService.get<string>('VAULT_ADDR', 'http://localhost:8200');
    const vaultToken = this.configService.get<string>('VAULT_TOKEN');

    if (!vaultToken) {
      this.logger.warn('VAULT_TOKEN not configured - key retrieval will fail');
    }

    this.vaultClient = vault({
      apiVersion: 'v1',
      endpoint: vaultAddr,
      token: vaultToken,
    });

    this.logger.log(`Vault client initialized: ${vaultAddr}`);
  }

  async getAttestationKey(keyPath: string): Promise<AttestationKey> {
    // Check cache first
    const cached = this.keyCache.get(keyPath);
    if (cached) {
      const age = Date.now() - cached.cachedAt.getTime();
      if (age < this.cacheTtl) {
        this.logger.debug(`Using cached key for ${keyPath} (age: ${age}ms)`);
        return cached.key;
      }
    }

    this.logger.log(`Retrieving attestation key from Vault: ${keyPath}`);

    try {
      const result = await this.vaultClient.read(keyPath);

      if (!result?.data?.data) {
        throw new Error('Invalid Vault response structure');
      }

      const keyData = result.data.data;

      if (!keyData.privateKey) {
        throw new Error('Private key not found in Vault secret');
      }

      const attestationKey: AttestationKey = {
        privateKey: keyData.privateKey,
        publicKey: keyData.publicKey || this.derivePublicKey(keyData.privateKey),
        address: keyData.address || this.deriveAddress(keyData.privateKey),
      };

      // Cache the key
      this.keyCache.set(keyPath, {
        key: attestationKey,
        cachedAt: new Date(),
      });

      this.logger.log(`Successfully retrieved attestation key (address: ${attestationKey.address})`);

      return attestationKey;
    } catch (error) {
      this.logger.error(`Failed to retrieve key from Vault: ${error.message}`);
      throw new Error(`Vault key retrieval failed: ${error.message}`);
    }
  }

  private derivePublicKey(privateKey: string): string {
    try {
      const publicKey = sm2.getPublicKeyFromPrivateKey(privateKey);
      return publicKey;
    } catch (error) {
      this.logger.error(`Failed to derive public key: ${error.message}`);
      throw error;
    }
  }

  private deriveAddress(privateKey: string): string {
    try {
      // For FISCO BCOS, address is derived from public key
      const publicKey = this.derivePublicKey(privateKey);
      // Take last 20 bytes of keccak256(publicKey) as address
      // This is a simplified version - actual implementation may vary
      const address = '0x' + publicKey.slice(-40);
      return address;
    } catch (error) {
      this.logger.error(`Failed to derive address: ${error.message}`);
      throw error;
    }
  }

  clearCache(): void {
    this.keyCache.clear();
    this.logger.log('Key cache cleared');
  }
}
