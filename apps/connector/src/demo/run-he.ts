/* eslint-disable no-console */
// HE secure-aggregation demo: 2 hospitals encrypt their RWS bucket counts under
// the pharma's public key; the control plane sums the CIPHERTEXTS without any
// secret key (it never sees per-hospital values); only the pharma decrypts the
// merged result. Strengthens "数据不出域" — even aggregates stay encrypted to
// the center.
//
// Run: pnpm --filter @medtrust/connector demo:he
import { HeSecureAggregator } from '../domain/he-aggregator';

const BUCKETS = ['神经系统', '血液系统', '胃肠系统', '肝胆系统'];

async function main() {
  console.log('\n=== HE 跨院加密聚合:恒瑞医药(密钥持有)× 华山 + 瑞金 ===\n');
  const he = await HeSecureAggregator.create();

  // 1) consumer (药企) generates keys; only the public key enters the space
  const { publicKey, secretKey } = he.generateKeys();
  console.log('1. 药企生成 CKKS 密钥;仅公钥进入数据空间(私钥自留)');

  // 2) each hospital encrypts its local bucket counts under the pharma's pubkey
  const huashan = [6, 4, 3, 2];
  const ruijin = [5, 0, 1, 2];
  const cipherA = he.encrypt(publicKey, huashan);
  const cipherB = he.encrypt(publicKey, ruijin);
  console.log(`2. 各院本地加密上报(密文,中心不可见明文):`);
  console.log(`     华山密文长度 ${cipherA.length}、瑞金密文长度 ${cipherB.length}`);

  // 3) control plane sums ciphertexts WITHOUT the secret key
  const merged = he.sum([cipherA, cipherB]);
  console.log('3. 中心控制面对密文求和(无私钥,无法解密,看不到单院数)');

  // 4) only the pharma decrypts the merged result
  const result = he.decrypt(secretKey, merged, BUCKETS.length);
  console.log('4. 药企解密合并结果:');
  BUCKETS.forEach((b, i) => console.log(`     · ${b}: ${result[i]} 例`));

  const expected = huashan.map((v, i) => v + ruijin[i]);
  console.log(`\n校验:解密结果 = 各院明文逐项之和? ${JSON.stringify(result) === JSON.stringify(expected) ? '是 ✓' : '否 ✗'}`);
  console.log('中心看到的单院明文行数:0  ·  仅密文经过中心\n');
}

main();
