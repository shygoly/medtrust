import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CryptoModule } from './crypto/crypto.module';
import { VaultModule } from './vault/vault.module';
import { MaskingInterceptor } from './interceptors/masking.interceptor';

@Global()
@Module({
  imports: [ConfigModule, CryptoModule, VaultModule],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: MaskingInterceptor,
    },
  ],
  exports: [CryptoModule, VaultModule],
})
export class SecurityModule {}
