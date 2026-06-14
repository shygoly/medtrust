import SEAL from 'node-seal';

export interface HeKeyPair {
  publicKey: string; // serialized, shared into the space
  secretKey: string; // kept by the consumer only
}

// 同态加密(CKKS)安全聚合 PoC.
//
// Positioning: an additive-HE channel that strengthens cross-connector
// aggregation. Each hospital encrypts its per-bucket counts under the consumer's
// public key; the control plane sums the CIPHERTEXTS without any secret key —
// so it never sees per-hospital values — and only the consumer (药企) decrypts
// the merged result. Complements the output gate / orchestrator merge step.
//
// node-seal = Microsoft SEAL compiled to WASM, so this runs in-process on the
// connector (no external service, no native build). Heavier ops would move to an
// OpenFHE / SecretFlow gateway; additive aggregation fits HE's sweet spot.
export class HeSecureAggregator {
  private constructor(
    private readonly seal: any,
    private readonly context: any,
    private readonly encoder: any,
    private readonly evaluator: any,
    private readonly scale: number,
  ) {}

  static async create(): Promise<HeSecureAggregator> {
    const seal = await SEAL();
    const schemeType = seal.SchemeType.ckks;
    const securityLevel = seal.SecurityLevel.tc128;
    const polyModulusDegree = 8192;
    const bitSizes = [60, 40, 40, 60];

    const params = seal.EncryptionParameters(schemeType);
    params.setPolyModulusDegree(polyModulusDegree);
    params.setCoeffModulus(seal.CoeffModulus.Create(polyModulusDegree, Int32Array.from(bitSizes)));

    const context = seal.Context(params, true, securityLevel);
    const encoder = seal.CKKSEncoder(context);
    const evaluator = seal.Evaluator(context);
    return new HeSecureAggregator(seal, context, encoder, evaluator, Math.pow(2, 40));
  }

  // —— consumer side: generate the keypair; only the public key is shared ——
  generateKeys(): HeKeyPair {
    const keyGenerator = this.seal.KeyGenerator(this.context);
    const publicKey = keyGenerator.createPublicKey();
    const secretKey = keyGenerator.secretKey();
    return { publicKey: publicKey.save(), secretKey: secretKey.save() };
  }

  // —— hospital side: encrypt a counts vector under the consumer's public key ——
  encrypt(publicKey: string, counts: number[]): string {
    const pk = this.seal.PublicKey();
    pk.load(this.context, publicKey);
    const encryptor = this.seal.Encryptor(this.context, pk);
    const plain = this.encoder.encode(Float64Array.from(counts), this.scale);
    const cipher = encryptor.encrypt(plain);
    return cipher.save();
  }

  // —— control-plane side: sum ciphertexts WITHOUT any secret key ——
  // This method deliberately has no access to a secret key — it cannot decrypt.
  sum(ciphertexts: string[]): string {
    if (ciphertexts.length === 0) throw new Error('no ciphertexts to aggregate');
    const acc = this.seal.CipherText();
    acc.load(this.context, ciphertexts[0]);
    for (let i = 1; i < ciphertexts.length; i++) {
      const c = this.seal.CipherText();
      c.load(this.context, ciphertexts[i]);
      this.evaluator.add(acc, c, acc); // homomorphic add, in place
    }
    return acc.save();
  }

  // —— consumer side: decrypt the merged ciphertext ——
  decrypt(secretKey: string, merged: string, length: number): number[] {
    const sk = this.seal.SecretKey();
    sk.load(this.context, secretKey);
    const decryptor = this.seal.Decryptor(this.context, sk);
    const cipher = this.seal.CipherText();
    cipher.load(this.context, merged);
    const plain = decryptor.decrypt(cipher);
    const decoded = this.encoder.decode(plain);
    return Array.from(decoded.slice(0, length) as Float64Array).map((x) => Math.round(x));
  }
}
