import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FeatureFlags {
  federatedLearning: boolean;
  mpc: boolean;
  tee: boolean;
  blockchain: boolean;
  fhir: boolean;
}

@Injectable()
export class FeatureFlagService {
  private readonly flags: FeatureFlags;

  constructor(private readonly configService: ConfigService) {
    this.flags = {
      federatedLearning: this.configService.get<boolean>('FEATURE_FEDERATED_LEARNING', true),
      mpc: this.configService.get<boolean>('FEATURE_MPC', true),
      tee: this.configService.get<boolean>('FEATURE_TEE', true),
      blockchain: this.configService.get<boolean>('FEATURE_BLOCKCHAIN', true),
      fhir: this.configService.get<boolean>('FEATURE_FHIR', true),
    };
  }

  isEnabled(feature: keyof FeatureFlags): boolean {
    return this.flags[feature];
  }

  getAllFlags(): FeatureFlags {
    return { ...this.flags };
  }

  isFederatedLearningEnabled(): boolean {
    return this.flags.federatedLearning;
  }

  isMpcEnabled(): boolean {
    return this.flags.mpc;
  }

  isTeeEnabled(): boolean {
    return this.flags.tee;
  }

  isBlockchainEnabled(): boolean {
    return this.flags.blockchain;
  }

  isFhirEnabled(): boolean {
    return this.flags.fhir;
  }
}
