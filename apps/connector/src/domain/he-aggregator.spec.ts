import { HeSecureAggregator } from './he-aggregator';

describe('HeSecureAggregator — 同态加密跨院聚合 (CKKS)', () => {
  let he: HeSecureAggregator;
  beforeAll(async () => {
    he = await HeSecureAggregator.create();
  }, 30000);

  it('center sums ciphertexts blind; only the consumer decrypts the correct sum', () => {
    // consumer (药企) keys — only the public key is shared
    const { publicKey, secretKey } = he.generateKeys();

    // two hospitals encrypt their per-bucket counts under the consumer's pubkey
    const huashan = [6, 4, 3, 2]; // 神经/血液/胃肠/肝胆
    const ruijin = [5, 0, 1, 2];
    const cipherA = he.encrypt(publicKey, huashan);
    const cipherB = he.encrypt(publicKey, ruijin);

    // control plane sums ciphertexts WITHOUT the secret key
    const merged = he.sum([cipherA, cipherB]);

    // consumer decrypts → element-wise sum
    const result = he.decrypt(secretKey, merged, 4);
    expect(result).toEqual([11, 4, 4, 4]);
  });

  it('ciphertext reveals nothing in plaintext form', () => {
    const { publicKey } = he.generateKeys();
    const cipher = he.encrypt(publicKey, [184300, 0, 0, 0]);
    expect(cipher).not.toContain('184300');
  });
});
