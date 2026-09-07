import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface SealedInput {
  iv: string;
  ciphertext: string;
  tag: string;
}

export interface TeeAttestation {
  enclave: string;
  measurement: string; // mr-enclave-like digest of the running code
  level: 'software' | 'hardware'; // D9/D-RWS-4: 硬件远程证明接入前只能是 software
}

export interface TeeResult<O> {
  output: O;
  attestation: TeeAttestation;
}

// 可插拔 TEE 抽象 (D9). Production targets a hardware enclave (海光 CSV); the
// computation contract is identical: sensitive data goes in sealed, the function
// runs over decrypted data INSIDE the enclave, and only the output + a remote
// attestation come out. Decrypted data is never returned or persisted.
export interface TeeEnclave {
  seal(data: unknown): SealedInput;
  run<O>(sealed: SealedInput, fn: (data: any) => O): TeeResult<O>;
}

// Software confidential-computing implementation: the enclave key is generated
// in-enclave and never exported ("encrypted memory"); sealed input cannot be
// decrypted outside. Stands in until a hardware enclave is wired (5.1).
@Injectable()
export class SoftwareTee implements TeeEnclave {
  private readonly key = randomBytes(32); // enclave-resident, never exported
  readonly enclaveId = 'sw-tee-' + randomBytes(4).toString('hex');

  seal(data: unknown): SealedInput {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return { iv: iv.toString('hex'), ciphertext: ct.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
  }

  run<O>(sealed: SealedInput, fn: (data: any) => O): TeeResult<O> {
    // decrypt INSIDE the enclave boundary
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(sealed.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'hex')),
      decipher.final(),
    ]).toString('utf8');
    const data = JSON.parse(plain);
    const output = fn(data); // compute over decrypted data, in-enclave only
    // `plain`/`data` go out of scope here — only output + attestation leave
    return { output, attestation: { enclave: this.enclaveId, measurement: 'mr:' + this.enclaveId, level: 'software' } };
  }
}
