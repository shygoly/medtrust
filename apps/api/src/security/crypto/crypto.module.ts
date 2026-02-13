import { Module } from '@nestjs/common';
import { GMCryptoService } from './gm-crypto.service';

@Module({
  providers: [GMCryptoService],
  exports: [GMCryptoService],
})
export class CryptoModule {}
